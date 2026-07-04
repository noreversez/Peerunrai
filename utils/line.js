import axios from 'axios';

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN || '';

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

export async function replyWithFlex(replyToken, keyword, results, totalFound, page = 1, itemsPerPage = 30, cleanKey = "") {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const bubbles = [];
  const itemsPerBubble = 10;
  const bubbleCount = Math.ceil(results.length / itemsPerBubble);
  const mainSearchTerm = cleanKey.replace(/\s+/g, "").toLowerCase();

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
                "url": "https://cdn-icons-png.flaticon.com/512/54/54481.png",
                "size": "16px",
                "flex": 0
              },
              {
                "type": "text",
                "text": "ผลการค้นหา",
                "size": "sm",
                "weight": "bold",
                "color": "#0F4C81"
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
                "size": "xxs",
                "align": "center",
                "weight": "bold"
              }
            ]
          }
        ]
      }
    ];

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
          {
            "type": "text",
            "text": fullName,
            "size": "md",
            "weight": "bold",
            "color": "#111111",
            "wrap": true
          },
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
            "url": "https://img1.pic.in.th/images/ChatGPT-Image-8-..-2569-13_52_39.png",
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
    
    bubbles.push({
      "type": "bubble",
      "size": "mega",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "image",
            "url": "https://img1.pic.in.th/images/ChatGPT-Image-8-..-2569-13_52_39.png",
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
              }
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
    "altText": `ผลการค้นหา: ${keyword} (${totalFound} รายการ)`,
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
    throw new Error(apiError);
  }
}
