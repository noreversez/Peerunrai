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
    
    const userBoxes = chunk.map((user) => {
      const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
      const nameNoSpace = fullName.replace(/\s+/g, "").toLowerCase();
      const isExactMatch = nameNoSpace.includes(mainSearchTerm) && mainSearchTerm.length > 1;

      return {
        "type": "box",
        "layout": "horizontal",
        "backgroundColor": "#FFFFFF",
        "cornerRadius": "md",
        "paddingAll": "md",
        "alignItems": "center",
        "contents": [
          {
            "type": "image",
            "url": "https://cdn-icons-png.flaticon.com/512/1144/1144760.png",
            "size": "16px",
            "aspectRatio": "1:1",
            "flex": 0
          },
          {
            "type": "text",
            "text": fullName,
            "margin": "md",
            "weight": "bold",
            "color": isExactMatch ? "#0F4C81" : "#333333",
            "size": "md"
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
            "paddingTop": "xs",
            "paddingBottom": "xs",
            "width": "60px",
            "flex": 0
          }
        ]
      };
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
        "backgroundColor": "#F7F9FC",
        "contents": [
          {
            "type": "box",
            "layout": "horizontal",
            "contents": [
              {
                "type": "box",
                "layout": "horizontal",
                "alignItems": "center",
                "contents": [
                  {
                    "type": "image",
                    "url": "https://cdn-icons-png.flaticon.com/512/54/54481.png",
                    "size": "18px",
                    "aspectRatio": "1:1",
                    "flex": 0
                  },
                  {
                    "type": "text",
                    "text": "ผลการค้นหา",
                    "weight": "bold",
                    "size": "lg",
                    "color": "#0F4C81",
                    "gravity": "center",
                    "margin": "sm"
                  }
                ]
              },
              {
                "type": "box",
                "layout": "vertical",
                "contents": [
                  {
                    "type": "text",
                    "text": `พบทั้งหมด ${totalFound} รายการ`,
                    "color": "#16A34A",
                    "size": "xs",
                    "align": "center",
                    "gravity": "center"
                  }
                ],
                "backgroundColor": "#E8EDF5",
                "cornerRadius": "md",
                "paddingStart": "sm",
                "paddingEnd": "sm",
                "paddingTop": "xs",
                "paddingBottom": "xs",
                "flex": 0
              }
            ],
            "justifyContent": "space-between",
            "alignItems": "center"
          },
          {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "margin": "md",
            "contents": userBoxes
          }
        ],
        "paddingAll": "md"
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": "#F7F9FC",
        "contents": [
          {
            "type": "text",
            "text": "โรตี79",
            "color": "#4A607A",
            "size": "xs",
            "align": "center"
          }
        ],
        "paddingBottom": "md",
        "paddingTop": "none"
      }
    });
  }

  if (totalFound > page * itemsPerPage) {
    const safeKeyword = keyword.substring(0, 50);
    bubbles.push({
      "type": "bubble", "size": "micro",
      "body": {
        "type": "box", "layout": "vertical",
        "contents": [{
          "type": "button",
          "action": {
            "type": "postback", "label": "ดูหน้าถัดไป ➡️",
            "data": `action=search&keyword=${encodeURIComponent(safeKeyword)}&page=${page + 1}`
          },
          "style": "primary", "color": "#1a365d"
        }],
        "justifyContent": "center", "alignItems": "center", "paddingAll": "20px"
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
    console.error("Error replying with flex:", e?.response?.data || e.message);
  }
}
