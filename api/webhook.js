import { supabase } from '../utils/supabase.js';
import { replyWithText, replyWithFlex, showLoadingAnimation } from '../utils/line.js';
import { searchUsers } from '../utils/search.js';

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
          if (userId) await showLoadingAnimation(userId);
          
          if (keyword.length <= 1) {
            await replyWithText(replyToken, `⚠️ คำค้นหา "${keyword}" สั้นเกินไป\nกรุณาระบุนามสกุลแทน หรือพิมพ์ "ชื่อ นามสกุล" เว้นวรรคเพิ่มเติมครับ`);
            continue;
          }

          // ค้นหาใน Supabase
          const page = 1; 
          const { results, total } = await searchUsers(keyword, page, 30);
          
          if (total === 0) {
            await replyWithText(replyToken, `❌ ไม่พบข้อมูล นรต. ที่ตรงกับ "${keyword}"`);
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
