const fs = require('fs');
const content = fs.readFileSync('c:/Users/USUARIO/Downloads/tienda/src/components/ContabilidadView.jsx', 'utf8');

let openBraces = 0;
let closeBraces = 0;
let openDivs = 0;
let closeDivs = 0;

for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') openBraces++;
    if (content[i] === '}') closeBraces++;
}

const divMatches = content.match(/<div/g) || [];
const closeDivMatches = content.match(/<\/div>/g) || [];

console.log('Open Braces:', openBraces);
console.log('Close Braces:', closeBraces);
console.log('Open Divs:', divMatches.length);
console.log('Close Divs:', closeDivMatches.length);
