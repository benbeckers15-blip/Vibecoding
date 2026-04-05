const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./winery_classifications_all.json'));
const filtered = data.filter(w => !w.title.toLowerCase().includes('lamont'));
fs.writeFileSync('./winery_classifications_all.json', JSON.stringify(filtered, null, 2));
console.log('Removed Lamonts. Remaining:', filtered.length, 'wineries');