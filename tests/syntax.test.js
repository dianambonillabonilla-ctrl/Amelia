const fs = require('fs');
const vm = require('vm');

fs.readdirSync('apps-script').filter((f) => f.endsWith('.gs')).forEach((file) => {
  new vm.Script(fs.readFileSync('apps-script/' + file, 'utf8'), { filename: file });
});

fs.readdirSync('.').filter((f) => f.endsWith('.html')).forEach((file) => {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
  let i = 0;
  for (const match of scripts) new vm.Script(match[1], { filename: file + '#' + (++i) });
});
console.log('syntax: OK');
