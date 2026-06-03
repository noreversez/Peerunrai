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
    const listContents = chunk.flatMap((user, index) => {
      const itemNumber = ((page - 1) * itemsPerPage) + (i * itemsPerBubble) + index + 1;
      const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
      const nameNoSpace = fullName.replace(/\s+/g, "").toLowerCase();
      const isExactMatch = nameNoSpace.includes(mainSearchTerm) && mainSearchTerm.length > 1;

      const itemBox = {
        "type": "text",
        "text": `${itemNumber}. ${fullName} รุ่น ${user.generation}`,
        "size": isExactMatch ? "md" : "sm",
        "weight": isExactMatch ? "bold" : "regular",
        "color": isExactMatch ? "#2e7d32" : "#333333",
        "wrap": true,
        "align": "center"
      };

      if (index < chunk.length - 1) {
        return [itemBox, { "type": "separator", "margin": "md", "color": "#e0e0e0" }];
      }
      return [itemBox];
    });

    bubbles.push({
      "type": "bubble",
      "size": (totalFound <= 5 && page === 1) ? "giga" : "mega",
      "header": {
        "type": "box", "layout": "baseline", "spacing": "sm",
        "contents": [
          { "type": "icon", "url": "https://img.icons8.com/material-rounded/48/ffffff/search.png", "size": "sm" },
          { "type": "text", "text": `ผลการค้นหา (${i + 1}/${bubbleCount})`, "color": "#ffffff", "weight": "bold", "size": "sm" }
        ],
        "backgroundColor": "#1a365d", "paddingAll": "12px", "justifyContent": "center"
      },
      "body": {
        "type": "box", "layout": "vertical", "spacing": "md",
        "contents": listContents,
        "paddingAll": "15px"
      },
      "footer": {
        "type": "box", "layout": "vertical",
        "contents": [{ "type": "text", "text": "Geno3179", "color": "#aaaaaa", "size": "xxs", "align": "center" }],
        "paddingAll": "10px", "paddingTop": "0px"
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
