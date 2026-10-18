import axios from 'axios';
import crypto from 'crypto';
import { tokenize } from './search.js';

const LINE_ACCESS_TOKEN  = process.env.LINE_ACCESS_TOKEN  || '';
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

// อ่าน raw body จาก stream (ต้องปิด bodyParser ที่ฝั่ง webhook)
export async function getRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ตรวจลายเซ็น x-line-signature ว่ามาจาก LINE จริง (HMAC-SHA256 ด้วย Channel Secret)
// คืน true/false ตามผลการตรวจ — เรียกใช้เฉพาะเมื่อ verifyLineSignature.enabled === true
export function verifyLineSignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(rawBody || '', 'utf8')
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// เปิดตรวจลายเซ็นก็ต่อเมื่อมีการตั้ง Channel Secret ไว้แล้วเท่านั้น
verifyLineSignature.enabled = !!LINE_CHANNEL_SECRET;

export async function showLoadingAnimation(userId) {
  const url = 'https://api.line.me/v2/bot/chat/loading/start';
  const payload = {
    chatId: userId,
    loadingSeconds: 20
  };
  try {
    await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
      }
    });
  } catch (e) {
    console.error("Loading Animation Error:", e?.response?.data || e.message);
  }
}

export async function replyWithText(replyToken, messageText, quickReplyItems = null) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const messageObj = { type: 'text', text: messageText };
  if (quickReplyItems && quickReplyItems.length > 0) {
    messageObj.quickReply = { items: quickReplyItems };
  }
  const payload = { replyToken, messages: [messageObj] };

  try {
    await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
      }
    });
  } catch (e) {
    console.error("Error replying with text:", e?.response?.data || e.message);
  }
}

// สระบน/ล่าง วรรณยุกต์ ฯลฯ ที่ต้องอยู่ติดพยัญชนะตัวก่อนหน้า — ไม่ตัด span กลางกลุ่มตัวอักษร
// ไม่งั้นเครื่องหมายอาจหลุดลอยตอนแสดงผล
const THAI_COMBINING = /[ัิ-ฺ็-๎]/;

// แบ่งข้อความเป็นช่วง ๆ ว่าช่วงไหนตรงกับคำที่ค้น (hit) — ใช้ tokenize ตัวเดียวกับระบบค้นหา
// (ตัดยศ แก้ตัวอักษรไทยซ้อน) และเหมือนเว็บคือข้ามคำสั้นกว่า 2 ตัวและตัวเลขรุ่น
export function highlightSegments(text, keyword) {
  const tokens = tokenize(keyword).filter(t => t.length >= 2 && !/^[0-9]+$/.test(t));
  if (!text || tokens.length === 0) return [{ text, hit: false }];

  const lowerText = text.toLowerCase();
  const hay = lowerText.length === text.length ? lowerText : text;
  const mask = new Array(text.length).fill(false);

  for (const t of tokens) {
    const lowerTok = t.toLowerCase();
    const needle = lowerTok.length === t.length ? lowerTok : t;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      let end = at + needle.length;
      while (end < text.length && THAI_COMBINING.test(text[end])) end++;
      for (let k = at; k < end; k++) mask[k] = true;
      from = at + 1;
    }
  }

  const segments = [];
  for (let k = 0; k < text.length; k++) {
    const last = segments[segments.length - 1];
    if (last && last.hit === mask[k]) last.text += text[k];
    else segments.push({ text: text[k], hit: mask[k] });
  }
  return segments;
}

// ข้อความชื่อในการ์ด: ถ้ามีคำตรง → ส่วนที่ตรงเป็นตัวหนาสีน้ำเงิน ที่เหลือเป็นตัวบางสีเทา
// ถ้าไม่มีส่วนไหนตรง (เช่น ตรงด้วยเสียง) → แสดงตัวหนาสีดำแบบเดิมทั้งชื่อ
export function nameTextComponent(fullName, keyword) {
  const segments = highlightSegments(fullName, keyword);
  const base = { "type": "text", "size": "md", "wrap": true };
  if (!segments.some(s => s.hit)) {
    return { ...base, "text": fullName, "weight": "bold", "color": "#111111" };
  }
  return {
    ...base,
    "contents": segments.map(s => s.hit
      ? { "type": "span", "text": s.text, "weight": "bold",    "color": "#0F4C81" }
      : { "type": "span", "text": s.text, "weight": "regular", "color": "#475569" })
  };
}

// ส่งการ์ดผลค้นหา — ปกติส่งแบบไฮไลต์คำค้น ถ้า LINE ปฏิเสธ (400) จะส่งซ้ำแบบไม่ไฮไลต์ทันที
// กันกรณีรูปแบบ span ไม่ผ่านการตรวจของ LINE แล้วทุกคนเห็นแต่ข้อความธรรมดาแทนการ์ด
export async function replyWithFlex(replyToken, keyword, results, totalFound, page = 1, itemsPerPage = 30, cleanKey = "", isExact = true) {
  try {
    return await sendFlexResults(replyToken, keyword, results, totalFound, page, itemsPerPage, cleanKey, isExact, true);
  } catch (e) {
    if (e.status !== 400) throw e;
    console.warn('LINE ปฏิเสธการ์ดแบบไฮไลต์ → ส่งซ้ำแบบไม่ไฮไลต์:', e.message);
    return await sendFlexResults(replyToken, keyword, results, totalFound, page, itemsPerPage, cleanKey, isExact, false);
  }
}

async function sendFlexResults(replyToken, keyword, results, totalFound, page, itemsPerPage, cleanKey, isExact, useHighlight) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const bubbles = [];
  const itemsPerBubble = 10;
  const bubbleCount = Math.ceil(results.length / itemsPerBubble);

  for (let i = 0; i < bubbleCount; i++) {
    const chunk = results.slice(i * itemsPerBubble, (i + 1) * itemsPerBubble);
    
    const innerContents = [
      {
        "type": "box",
        "layout": "horizontal",
        "justifyContent": "space-between",
        "alignItems": "center",
        "contents": [
          {
            "type": "box",
            "layout": "horizontal",
            "alignItems": "center",
            "spacing": "sm",
            "contents": [
              {
                "type": "image",
                "url": "https://peerunrai.vercel.app/icon-search.png",
                "size": "16px",
                "flex": 0
              },
              {
                "type": "text",
                "text": isExact ? "ผลการค้นหา" : "ผลใกล้เคียง (ไม่พบที่ตรงทั้งหมด)",
                "size": "sm",
                "weight": "bold",
                "wrap": true,
                "color": isExact ? "#0F4C81" : "#D97706"
              }
            ]
          },
          {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#E8EDF5",
            "cornerRadius": "md",
            "paddingStart": "8px",
            "paddingEnd": "8px",
            "paddingTop": "4px",
            "paddingBottom": "4px",
            "flex": 0,
            "contents": [
              {
                "type": "text",
                "text": `พบ ${totalFound} รายการ`,
                "color": "#16A34A",
                "size": "xs",
                "align": "center",
                "weight": "bold"
              }
            ]
          }
        ]
      }
    ];

    // ผลใกล้เคียง: บอกว่าเรียงลำดับตามอะไร (ให้ตรงกับแบนเนอร์บนเว็บ)
    if (!isExact) {
      innerContents.push({
        "type": "text",
        "text": "เรียงจากที่ใกล้เคียงที่สุดก่อน",
        "size": "xs",
        "color": "#B45309",
        "margin": "sm",
        "wrap": true
      });
    }

    chunk.forEach((user, index) => {
      innerContents.push({
        "type": "separator",
        "color": index === 0 ? "#E8EDF5" : "#F1F5F9",
        "margin": "md"
      });

      const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
      const numIdx = (page - 1) * itemsPerPage + index + 1;

      innerContents.push({
        "type": "box",
        "layout": "horizontal",
        "alignItems": "center",
        "spacing": "md",
        "margin": "md",
        "contents": [
          {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#0F4C81",
            "cornerRadius": "xl",
            "width": "24px",
            "height": "24px",
            "justifyContent": "center",
            "alignItems": "center",
            "flex": 0,
            "contents": [
              {
                "type": "text",
                "text": String(numIdx),
                "color": "#FFFFFF",
                "size": "xs",
                "weight": "bold",
                "align": "center"
              }
            ]
          },
          useHighlight
            ? nameTextComponent(fullName, cleanKey || keyword)
            : { "type": "text", "text": fullName, "size": "md", "weight": "bold", "color": "#111111", "wrap": true },
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": `รุ่น ${user.generation || '-'}`,
                "color": "#FFFFFF",
                "size": "xs",
                "align": "center",
                "weight": "bold"
              }
            ],
            "backgroundColor": "#FF7A00",
            "cornerRadius": "xl",
            "paddingTop": "4px",
            "paddingBottom": "4px",
            "paddingStart": "10px",
            "paddingEnd": "10px",
            "flex": 0
          }
        ]
      });
    });

    bubbles.push({
      "type": "bubble",
      "size": "mega",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "image",
            "url": "https://peerunrai.vercel.app/line-banner.jpg",
            "size": "full",
            "aspectMode": "cover",
            "aspectRatio": "21:9"
          }
        ],
        "paddingAll": "none"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "paddingAll": "14px",
        "backgroundColor": "#F7F9FC",
        "contents": [
          {
            "type": "box",
            "layout": "vertical",
            "paddingAll": "16px",
            "cornerRadius": "14px",
            "borderWidth": "2px",
            "borderColor": "#0F4C81",
            "backgroundColor": "#FFFFFF",
            "contents": innerContents
          }
        ]
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": "#F7F9FC",
        "spacing": "sm",
        "contents": [
          {
            "type": "button",
            "style": "primary",
            "color": "#0F4C81",
            "height": "sm",
            "action": {
              "type": "uri",
              "label": "🌐 ดูบนเว็บไซต์",
              "uri": `https://peerunrai.vercel.app/?q=${encodeURIComponent(cleanKey)}`
            }
          },
          {
            "type": "text",
            "text": "RPCA79",
            "color": "#4A607A",
            "size": "xs",
            "align": "center",
            "margin": "md"
          }
        ],
        "paddingBottom": "md",
        "paddingTop": "none",
        "paddingStart": "14px",
        "paddingEnd": "14px"
      }
    });
  }

  if (totalFound > page * itemsPerPage) {
    const safeKeyword = keyword.substring(0, 50);
    const remainingCount = totalFound - (page * itemsPerPage);

    // ผลเยอะและค้นด้วยคำเดียว (ไม่มีนามสกุลหรือเลขรุ่น): แนะนำให้ระบุเพิ่มเพื่อให้เจอตรงขึ้น
    // จะได้ไม่ต้องไล่เปิดทีละหน้า — แสดงเฉพาะหน้าแรกเพื่อไม่ให้ซ้ำทุกหน้า
    const hintTokens = tokenize(cleanKey || keyword);
    const nameTokens = hintTokens.filter(t => !/^[0-9]+$/.test(t));
    const showNarrowHint = page === 1 && totalFound > 20
      && nameTokens.length === 1 && nameTokens.length === hintTokens.length;
    const narrowHint = showNarrowHint ? [{
      "type": "text",
      "text": `💡 ผลเยอะ? ลองพิมพ์ "ชื่อ นามสกุล" หรือ "${nameTokens[0].slice(0, 20)} 79" (ชื่อ + รุ่น) เพื่อให้เจอตรงขึ้น`,
      "size": "xs",
      "color": "#B45309",
      "margin": "lg",
      "align": "center",
      "wrap": true
    }] : [];

    // ใบนี้ไม่มีแบนเนอร์ (มีแล้วที่ใบแรก) ให้การ์ดกะทัดรัดขึ้น
    bubbles.push({
      "type": "bubble",
      "size": "mega",
      "body": {
        "type": "box",
        "layout": "vertical",
        "paddingAll": "14px",
        "backgroundColor": "#F7F9FC",
        "contents": [
          {
            "type": "box",
            "layout": "vertical",
            "paddingAll": "20px",
            "cornerRadius": "14px",
            "borderWidth": "2px",
            "borderColor": "#0F4C81",
            "backgroundColor": "#FFFFFF",
            "justifyContent": "center",
            "alignItems": "center",
            "contents": [
              {
                "type": "text",
                "text": "ยังมีผลลัพธ์อีก!",
                "weight": "bold",
                "size": "lg",
                "color": "#0F4C81",
                "align": "center"
              },
              {
                "type": "text",
                "text": `ยังมีอีก ${remainingCount.toLocaleString('th-TH')} รายการ 🔍`,
                "size": "sm",
                "color": "#16A34A",
                "margin": "md",
                "weight": "bold",
                "align": "center"
              },
              {
                "type": "text",
                "text": "กดปุ่มด้านล่างเพื่อดูรายชื่อถัดไป",
                "size": "xs",
                "color": "#64748B",
                "margin": "sm",
                "align": "center"
              },
              ...narrowHint
            ]
          }
        ]
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": "#F7F9FC",
        "spacing": "sm",
        "contents": [
          {
            "type": "button",
            "style": "primary",
            "color": "#FF7A00",
            "height": "sm",
            "action": {
              "type": "postback",
              "label": "ดูหน้าถัดไป ➡️",
              "data": `action=search&keyword=${encodeURIComponent(safeKeyword)}&page=${page + 1}`
            }
          },
          {
            "type": "text",
            "text": "RPCA79",
            "color": "#4A607A",
            "size": "xs",
            "align": "center",
            "margin": "md"
          }
        ],
        "paddingBottom": "md",
        "paddingTop": "none",
        "paddingStart": "30px",
        "paddingEnd": "30px",
        "justifyContent": "center",
        "alignItems": "center"
      }
    });
  }

  let messages = [{
    "type": "flex",
    "altText": `${isExact ? 'ผลการค้นหา' : 'ผลใกล้เคียง'}: ${keyword} (${totalFound} รายการ)`,
    "contents": {
      "type": "carousel",
      "contents": bubbles
    }
  }];

  try {
    await axios.post(url, { replyToken, messages }, {
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN }
    });
  } catch (e) {
    const apiError = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("Error replying with flex:", apiError);
    const err = new Error(apiError);
    err.status = e?.response?.status;
    throw err;
  }
}

// =============================================
// replyWithWelcome: การ์ดต้อนรับตอนมีคนเพิ่มเพื่อนใหม่ (ใช้ reply ฟรี)
// โชว์ตัวอย่างค้นหา 3 แบบ: ชื่อ / นามสกุล / ชื่อ นามสกุล
// =============================================
export async function replyWithWelcome(replyToken) {
  const url = 'https://api.line.me/v2/bot/message/reply';

  const exampleRow = (icon, label, example) => ({
    "type": "box",
    "layout": "horizontal",
    "alignItems": "center",
    "spacing": "md",
    "margin": "md",
    "contents": [
      {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": "#E8EDF5",
        "cornerRadius": "xl",
        "width": "32px",
        "height": "32px",
        "justifyContent": "center",
        "alignItems": "center",
        "flex": 0,
        "contents": [
          { "type": "text", "text": icon, "size": "sm", "align": "center" }
        ]
      },
      {
        "type": "box",
        "layout": "vertical",
        "contents": [
          { "type": "text", "text": label, "size": "xs", "color": "#4A607A", "weight": "bold" },
          { "type": "text", "text": example, "size": "sm", "color": "#111111", "weight": "bold", "wrap": true }
        ]
      }
    ]
  });

  const bubble = {
    "type": "bubble",
    "size": "giga",
    "header": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "image",
          "url": "https://peerunrai.vercel.app/line-banner.jpg",
          "size": "full",
          "aspectMode": "cover",
          "aspectRatio": "21:9"
        }
      ],
      "paddingAll": "none"
    },
    "body": {
      "type": "box",
      "layout": "vertical",
      "paddingAll": "14px",
      "backgroundColor": "#F7F9FC",
      "contents": [
        {
          "type": "box",
          "layout": "vertical",
          "paddingAll": "16px",
          "cornerRadius": "14px",
          "borderWidth": "2px",
          "borderColor": "#0F4C81",
          "backgroundColor": "#FFFFFF",
          "contents": [
            {
              "type": "text",
              "text": "👮‍♂️ ยินดีต้อนรับสู่ระบบค้นหา นรต.",
              "size": "md",
              "weight": "bold",
              "color": "#0F4C81",
              "wrap": true
            },
            {
              "type": "text",
              "text": "📖 ตัวอย่างวิธีการใช้งาน",
              "size": "xs",
              "color": "#4A607A",
              "weight": "bold",
              "margin": "sm",
              "wrap": true
            },
            { "type": "separator", "color": "#E8EDF5", "margin": "lg" },
            exampleRow("🔤", "ค้นหาด้วยชื่อ", "สมชาย"),
            exampleRow("🏷️", "ค้นหาด้วยนามสกุล", "จันทวงศ์"),
            exampleRow("📝", "ค้นหาด้วยชื่อ + นามสกุล", "สมชาย ใจดี")
          ]
        }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "vertical",
      "backgroundColor": "#F7F9FC",
      "spacing": "sm",
      "contents": [
        {
          "type": "button",
          "style": "primary",
          "color": "#0F4C81",
          "height": "sm",
          "action": {
            "type": "uri",
            "label": "🌐 ดูบนเว็บไซต์",
            "uri": "https://peerunrai.vercel.app"
          }
        },
        {
          "type": "text",
          "text": "RPCA79",
          "color": "#4A607A",
          "size": "xs",
          "align": "center",
          "margin": "md"
        },
        {
          "type": "text",
          "text": "พัฒนาโดยน้อง นรต.79",
          "color": "#8A97A8",
          "size": "xxs",
          "align": "center",
          "margin": "xs"
        }
      ],
      "paddingBottom": "md",
      "paddingTop": "none",
      "paddingStart": "14px",
      "paddingEnd": "14px"
    }
  };

  const messages = [{
    "type": "flex",
    "altText": "ยินดีต้อนรับสู่ระบบค้นหา นรต. — พิมพ์ชื่อหรือนามสกุลเพื่อเริ่มค้นหา",
    "contents": bubble
  }];

  try {
    await axios.post(url, { replyToken, messages }, {
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN }
    });
  } catch (e) {
    const apiError = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("Error replying with welcome flex:", apiError);
    throw new Error(apiError);
  }
}
