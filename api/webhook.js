import { supabase } from '../utils/supabase.js';
import { replyWithText, replyWithFlex, showLoadingAnimation } from '../utils/line.js';
import { searchUsers, suggestUsers } from '../utils/search.js';

export default async function handler(req, res) {
  // รองรับเฉพาะ POST method จาก LINE
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).json({ success: true });
    }

    // ประมวลผล Event ที่เข้ามาทั้งหมด
    for (const event of events) {
      const replyToken = event.replyToken;
      const userId = event.source?.userId;

      // 1. จัดการข้อความ (Text Message)
      if (event.type === 'message' && event.message.type === 'text') {
        const text = event.message.text.trim();
        
        let keyword = "";
        let isSearch = false;

        if (text.startsWith("ค้นหา ")) {
          keyword = text.replace("ค้นหา ", "").replace(/\s+/g, " ").trim();
          isSearch = true;
        } else if (text.startsWith("รุ่น ")) {
          keyword = text.replace("รุ่น ", "").replace(/\s+/g, " ").trim();
          isSearch = true;
        } else {
          // พิมพ์ชื่อมาตรงๆ ก็ถือว่าค้นหาเหมือนโค้ดเดิม
          keyword = text.replace(/\s+/g, " ").trim();
          isSearch = true; 
        }

        if (isSearch && keyword === "") {
          await replyWithText(replyToken, "⚠️ กรุณาระบุคำที่ต้องการค้นหาด้วยครับ เช่น 'สมชาย'");
          continue;
        }

        if (isSearch && keyword) {
          // ตรวจสอบว่าเป็นชื่อสั้น (คำเดียว + ไม่เกิน 4 ตัวอักษร) หรือไม่
          const tokens = keyword.trim().split(/\s+/);
          const isSingleShortToken = tokens.length === 1 && keyword.replace(/\s+/g, '').length <= 4;

          if (keyword.replace(/\s+/g, '').length <= 1) {
            // สั้นเกินไปมาก (1 ตัวอักษร)
            await replyWithText(replyToken, `⚠️ คำค้นหา "${keyword}" สั้นเกินไปครับ\nกรุณาพิมพ์ชื่อให้ยาวกว่านี้`);
            continue;
          }

          if (isSingleShortToken) {
            // ชื่อสั้น เช่น "นที", "แอน", "บิ๊ก" → แนะนำก่อนค้นหา
            await replyWithText(replyToken,
              `🔍 กำลังค้นหา "${keyword}"...\n\n` +
              `💡 เคล็ดลับ: ชื่อ "${keyword}" อาจมีหลายคนครับ\n` +
              `ลองค้นหาแบบเหล่านี้จะแม่นยำกว่า:\n` +
              `• พิมพ์ชื่อ + นามสกุล เช่น "${keyword} สกุลจริง"\n` +
              `• พิมพ์ชื่อ + รุ่น เช่น "${keyword} 79"\n` +
              `• พิมพ์นามสกุลแทนชื่อ`
            );
            // ยังคงค้นหาต่อ แต่แจ้งล่วงหน้าก่อน
          }

          if (userId) await showLoadingAnimation(userId);

          // ค้นหาใน Supabase
          const page = 1; 
          const { results, total } = await searchUsers(keyword, page, 30);
          
          if (total === 0) {
            // ลองหาชื่อใกล้เคียงก่อน
            const suggestions = await suggestUsers(keyword);

            if (suggestions.length > 0) {
              // สร้าง Quick Reply buttons สำหรับแต่ละชื่อที่แนะนำ
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
                `❌ ไม่พบ "${keyword}" ในฐานข้อมูลครับ\n\n🤔 หรือคุณหมายถึง...\n${suggestions.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nกดเลือกชื่อด้านล่างได้เลยครับ 👇`,
                quickReplyItems
              );
            } else {
              await replyWithText(replyToken,
                `❌ ไม่พบข้อมูล นรต. ที่ตรงกับ "${keyword}"\n\n` +
                `💡 ลองใหม่ด้วย:\n` +
                `• ระบุนามสกุลแทนชื่อ\n` +
                `• พิมพ์ "ชื่อ นามสกุล" เว้นวรรคคั่น\n` +
                `• พิมพ์ "ชื่อ รุ่น" เช่น "สมชาย 79"`
              );
            }
          } else {
            await replyWithFlex(replyToken, keyword, results, total, page, 30, keyword);
          }
        } else {
          const helpMsg = "👮‍♂️ ยินดีต้อนรับสู่ระบบค้นหา นรต.\n\nกรุณาพิมพ์คำสั่งดังนี้:\n- ค้นหาชื่อ: พิมพ์ \"ค้นหา [ชื่อ]\"\n- ค้นหารุ่น: พิมพ์ \"รุ่น [เลขรุ่น]\"";
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
          const { results, total } = await searchUsers(keyword, page, 30);
          await replyWithFlex(replyToken, keyword, results, total, page, 30, keyword);
        }
      }
    }

    // ตอบกลับ LINE ว่ารับข้อความสำเร็จ
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
