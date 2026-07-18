import { supabase } from '../utils/supabase.js';
import { replyWithText, replyWithFlex, showLoadingAnimation, getRawBody, verifyLineSignature } from '../utils/line.js';
import { searchUsers, suggestUsers } from '../utils/search.js';
import { logSearch, getRecentSearches } from '../utils/logger.js';

// ปิด body parser ของ Vercel เพื่ออ่าน raw body มาตรวจลายเซ็นได้ถูกต้อง
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  // รองรับเฉพาะ POST method จาก LINE
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // อ่าน raw body (กรณี bodyParser ถูกปิดสำเร็จ) — ใช้ตรวจลายเซ็น
    const rawBody = await getRawBody(req);
    const hasRaw  = typeof rawBody === 'string' && rawBody.length > 0;

    // แยกร่างข้อมูล: ถ้า Vercel เผลอ parse ไปแล้ว (เป็น object) ให้ใช้ตัวนั้น
    // เพื่อให้บอทไม่มีวันพังแม้ปิด bodyParser ไม่สำเร็จ
    let body;
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (hasRaw) {
      try { body = JSON.parse(rawBody); }
      catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    } else {
      body = {};
    }

    // ตรวจลายเซ็น x-line-signature (กันคนปลอม event เข้ามา)
    // บังคับตรวจเฉพาะเมื่อ (1) ตั้ง LINE_CHANNEL_SECRET แล้ว และ (2) อ่าน raw body ได้จริง
    // ถ้าอ่าน raw ไม่ได้ (แพลตฟอร์มไม่เคารพ bodyParser:false) จะข้ามการตรวจ + เตือนใน log
    // เพื่อไม่ให้บอทล่ม — ดู log ยืนยันว่าการตรวจทำงานหลังตั้ง secret
    if (verifyLineSignature.enabled) {
      if (hasRaw) {
        if (!verifyLineSignature(rawBody, req.headers['x-line-signature'])) {
          console.warn('ปฏิเสธ webhook: ลายเซ็นไม่ถูกต้อง');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      } else {
        console.warn('ข้ามการตรวจลายเซ็น: อ่าน raw body ไม่ได้ (bodyParser:false อาจไม่มีผลบนแพลตฟอร์มนี้)');
      }
    }

    const events = body.events;
    if (!events || events.length === 0) {
      return res.status(200).json({ success: true });
    }

    // ประมวลผล Event ที่เข้ามาทั้งหมด
    for (const event of events) {
      const replyToken = event.replyToken;
      const userId = event.source?.userId;

      // 1. จัดการข้อความ (Text Message)
      if (event.type === 'message' && event.message.type === 'text') {
        const MAINTENANCE_MODE = false;
        if (MAINTENANCE_MODE) {
          await replyWithText(replyToken, "🛠️ แจ้งปิดปรับปรุงชั่วคราว\n\nเนื่องจากมีพี่ๆน้องๆเฮียๆเข้ามาใช้งานกันเยอะ อยู่ในการพัฒนาระบบชั่วคราวจะกลับมาเร็วๆนี้ครับ");
          continue;
        }

        const text = event.message.text.trim();

        // --- คำสั่งพิเศษ ---

        // ดูประวัติการค้นหาของตัวเอง
        if (text === 'ประวัติ' || text === 'ประวัติการค้นหา') {
          if (!userId) continue;
          const history = await getRecentSearches(userId);
          if (history.length === 0) {
            await replyWithText(replyToken, '📋 ยังไม่มีประวัติการค้นหาครับ');
          } else {
            const lines = history.map((h, i) => {
              const date = new Date(h.searched_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
              const found = h.results_count > 0 ? `(พบ ${h.results_count} คน)` : '(ไม่พบ)';
              return `${i + 1}. "${h.keyword}" ${found}\n    🕐 ${date}`;
            });
            // สร้าง Quick Reply ให้กดค้นหาซ้ำได้ทันที
            const quickReplyItems = history
              .filter(h => h.results_count > 0)
              .slice(0, 5)
              .map(h => ({
                type: 'action',
                action: { type: 'message', label: h.keyword.substring(0, 20), text: h.keyword },
              }));
            await replyWithText(
              replyToken,
              `📋 ประวัติการค้นหา 5 อันล่าสุดของคุณ:\n\n${lines.join('\n\n')}`,
              quickReplyItems.length > 0 ? quickReplyItems : null
            );
          }
          continue;
        }

        // --- ระบบค้นหาปกติ ---
        let keyword = '';
        let isSearch = false;

        if (text.startsWith('ค้นหา ')) {
          keyword = text.replace('ค้นหา ', '').replace(/\s+/g, ' ').trim();
          isSearch = true;
        } else if (text.startsWith('รุ่น ')) {
          keyword = text.replace('รุ่น ', '').replace(/\s+/g, ' ').trim();
          isSearch = true;
        } else {
          keyword = text.replace(/\s+/g, ' ').trim();
          isSearch = true;
        }

        if (isSearch && keyword === '') {
          await replyWithText(replyToken, "⚠️ กรุณาระบุคำที่ต้องการค้นหาด้วยครับ เช่น 'สมชาย'");
          continue;
        }

        if (isSearch && keyword) {
          // ตรวจสอบว่าเป็นชื่อสั้น (คำเดียว + ไม่เกิน 4 ตัวอักษร) หรือไม่
          const tokens = keyword.trim().split(/\s+/);
          const isSingleShortToken = tokens.length === 1 && keyword.replace(/\s+/g, '').length <= 4;

          if (keyword.replace(/\s+/g, '').length <= 1) {
            await replyWithText(replyToken, `⚠️ คำค้นหา "${keyword}" สั้นเกินไปครับ\nกรุณาพิมพ์ชื่อให้ยาวกว่านี้`);
            continue;
          }

          // แสดงแค่ Loading Animation (ห้ามใช้ replyToken ก่อนการค้นหาเสร็จสิ้น)
          if (userId) await showLoadingAnimation(userId);

          // ค้นหาใน Supabase (จำกัด 10 ต่อหน้าเพื่อความเร็ว)
          const page = 1;
          const { results, total, exact } = await searchUsers(keyword, page, 10);

          // บันทึก log แบบ async (ไม่ block การตอบกลับ)
          if (userId) logSearch(userId, keyword, total);

          let hintMsg = "";
          if (isSingleShortToken && total > 0) {
            hintMsg = `\n\n💡 ค้นหาเยอะเกินไป? ลองพิมพ์ "ชื่อ นามสกุล" หรือ "ชื่อ รุ่น" (เช่น ${keyword} 79) เพื่อให้แม่นยำขึ้นครับ`;
          }

          if (total === 0) {
            const suggestions = await suggestUsers(keyword);

            if (suggestions.length > 0) {
              const quickReplyItems = suggestions.map(name => ({
                type: 'action',
                action: {
                  type: 'message',
                  label: name.length > 20 ? name.substring(0, 20) : name,
                  text: name,
                },
              }));
              await replyWithText(
                replyToken,
                `❌ ไม่พบ "${keyword}" ในฐานข้อมูลครับ\n\n🤔 หรือคุณหมายถึง...\n${suggestions.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nกดเลือกชื่อด้านล่างได้เลยครับ 👇\n\n🌐 หรือลองค้นหาในเว็บไซต์อีกครั้งเพื่อความแม่นยำ`,
                quickReplyItems
              );
            } else {
              await replyWithText(replyToken,
                `❌ ไม่พบข้อมูล นรต. ที่ตรงกับ "${keyword}"\n\n` +
                `💡 ลองใหม่ด้วย:\n` +
                `• ระบุนามสกุลแทนชื่อ\n` +
                `• พิมพ์ "ชื่อ นามสกุล" เว้นวรรคคั่น\n` +
                `• พิมพ์ "ชื่อ รุ่น" เช่น "สมชาย 79"\n\n` +
                `🌐 หรือลองค้นหาในเว็บไซต์อีกครั้งเพื่อความแม่นยำ`
              );
            }
          } else {
            try {
              await replyWithFlex(replyToken, keyword, results, total, page, 10, keyword, exact);
            } catch (flexErr) {
              console.error('replyWithFlex failed, sending fallback text:', flexErr.message);
              await replyWithText(replyToken,
                `⚠️ ระบบประมวลผลนานเกินไปครับ\n\n` +
                `🔍 พบ "${keyword}" ทั้งหมด ${total} รายการ\n` +
                `กรุณาลองค้นหาที่เฉพาะเจาะจงขึ้น เช่น "${keyword} 79"\n\n` +
                `🌐 หรือค้นหาบนเว็บไซต์แทนครับ\nhttps://peerunrai.vercel.app/?q=${encodeURIComponent(keyword)}`
              );
            }
          }
        } else {
          const helpMsg = "👮‍♂️ ยินดีต้อนรับสู่ระบบค้นหา นรต.\n\nกรุณาพิมพ์คำสั่งดังนี้:\n- ค้นหาชื่อ: พิมพ์ \"ค้นหา [ชื่อ]\"\n- ค้นหารุ่น: พิมพ์ \"รุ่น [เลขรุ่น]\"\n- ดูประวัติ: พิมพ์ \"ประวัติ\"";
          await replyWithText(replyToken, helpMsg);
        }
      }
      // 2. จัดการการเปลี่ยนหน้า (Postback)
      else if (event.type === 'postback') {
        const data = new URLSearchParams(event.postback.data);
        if (data.get('action') === 'search') {
          const keyword = data.get('keyword');
          const page = parseInt(data.get('page'), 10) || 1;

          if (userId) await showLoadingAnimation(userId);
          const { results, total, exact } = await searchUsers(keyword, page, 10);
          // บันทึก log การเปิดหน้าถัดไปด้วย
          if (userId) logSearch(userId, `${keyword} (หน้า ${page})`, total);
          try {
            await replyWithFlex(replyToken, keyword, results, total, page, 10, keyword, exact);
          } catch (flexErr) {
            console.error('Postback replyWithFlex failed:', flexErr.message);
            await replyWithText(replyToken, `⚠️ เกิดข้อผิดพลาดครับ กรุณาลองใหม่อีกครั้ง หรือค้นหาบนเว็บไซต์\nhttps://peerunrai.vercel.app/?q=${encodeURIComponent(keyword)}`);
          }
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
