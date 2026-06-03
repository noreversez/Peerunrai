import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceFile = path.resolve(__dirname, '../../SearchAppScript.js');
const targetFile = path.resolve(__dirname, '../utils/line.js');

let code = fs.readFileSync(sourceFile, 'utf8');

// We want to extract functions related to LINE messaging.
// They start around "function buildProgressDots" and end before "function getUsers" or similar.
// Actually, they are scattered. Let's just find all functions that start with "send" or "replyWith" or "pushAdminNewMember" or "buildProgressDots" or "showLoadingAnimation".

const functionsToExtract = [
  'buildProgressDots',
  'sendWelcomeFlex',
  'sendStepNameFlex',
  'sendStepPhoneFlex',
  'sendStepEmailFlex',
  'sendStepGenerationFlex',
  'sendWaitConfirmFlex',
  'sendCancelFlex',
  'sendDuplicateFlex',
  'pushAdminNewMember',
  'sendRegistrationClosedFlex',
  'sendConfirmFlex',
  'sendSuccessFlex',
  'replyWithText',
  'replyWithFlex',
  'showLoadingAnimation'
];

let outCode = `import axios from 'axios';\n\nconst LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN || '';\n\n`;

for (const fn of functionsToExtract) {
  // Regex to match "function fnName(...args) { ... }" handling nested braces
  // This is a naive extraction. A better way is to use regex up to the next "function " declaration.
  // (regex removed for simplicity)
  
  // Actually, since the file format is standard, let's just find the start and then count braces.
  const startIndex = code.indexOf(\`function \${fn}(\`);
  if (startIndex === -1) {
    console.log(\`Function \${fn} not found!\`);
    continue;
  }
  
  let braceCount = 0;
  let endIndex = -1;
  let started = false;
  
  for (let i = startIndex; i < code.length; i++) {
    if (code[i] === '{') {
      braceCount++;
      started = true;
    } else if (code[i] === '}') {
      braceCount--;
    }
    
    if (started && braceCount === 0) {
      endIndex = i;
      break;
    }
  }
  
  if (endIndex !== -1) {
    let fnCode = code.substring(startIndex, endIndex + 1);
    
    // Replace UrlFetchApp with axios
    fnCode = fnCode.replace(/try\s*\{\s*UrlFetchApp\.fetch\(url,\s*\{[^}]*payload:\s*JSON\.stringify\(payload\)[^}]*\}\);\s*\}\s*catch\s*\(e\)\s*\{\s*console\.error\('[^']*',\s*e\);\s*\}/g, 
      \`try { await axios.post(url, payload, { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN } }); } catch (e) { console.error('Error in \${fn}:', e?.response?.data || e.message); }\`
    );

    // Replace other UrlFetchApp for replyWithText
    fnCode = fnCode.replace(/UrlFetchApp\.fetch\(url,\s*\{\s*method:\s*'post',\s*headers:\s*\{\s*'Content-Type':\s*'application\/json',\s*'Authorization':\s*'Bearer '\s*\+\s*LINE_ACCESS_TOKEN\s*\},\s*payload:\s*JSON\.stringify\(payload\),\s*muteHttpExceptions:\s*true\s*\}\);/g,
      \`await axios.post(url, payload, { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN } });\`
    );

    // Add export async (except for buildProgressDots which is sync)
    if (fn === 'buildProgressDots') {
      fnCode = fnCode.replace(\`function \${fn}\`, \`export function \${fn}\`);
    } else {
      fnCode = fnCode.replace(\`function \${fn}\`, \`export async function \${fn}\`);
    }
    
    outCode += fnCode + '\\n\\n';
  }
}

fs.writeFileSync(targetFile, outCode);
console.log('Successfully extracted LINE functions to utils/line.js');
