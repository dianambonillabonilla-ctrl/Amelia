const fs = require('fs');
const vm = require('vm');

const gsFiles = fs.readdirSync('apps-script').filter((f) => f.endsWith('.gs'));
gsFiles.forEach((file) => {
  new vm.Script(fs.readFileSync('apps-script/' + file, 'utf8'), { filename: file });
});

// Apps Script pega TODOS los archivos .gs de un proyecto en un solo espacio de nombres global —
// un archivo por sí solo puede tener sintaxis válida (el check de arriba) y aun así romper TODO
// el despliegue si otro archivo ya declaró el mismo `const`/`let` (ej. un bloque pegado dos veces
// por error al copiar a mano al editor de Apps Script, como pasó con GESTION_ESTADOS en
// Gestiones.gs). Simulamos ese mismo pegado en un solo `vm.Script` para agarrar esta clase de
// error aquí, antes de que llegue al editor de Apps Script.
const bundle = gsFiles.map((file) => fs.readFileSync('apps-script/' + file, 'utf8')).join('\n');
new vm.Script(bundle, { filename: 'apps-script (bundle combinado, como lo une Apps Script)' });

fs.readdirSync('.').filter((f) => f.endsWith('.html')).forEach((file) => {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
  let i = 0;
  for (const match of scripts) new vm.Script(match[1], { filename: file + '#' + (++i) });
});
console.log('syntax: OK');
