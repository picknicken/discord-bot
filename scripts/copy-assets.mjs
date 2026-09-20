import { cpSync, mkdirSync } from 'node:fs';

// tsc compileert alleen TypeScript; de dashboardpagina en haar scripts moeten
// mee naar dist/, anders draait een gebouwde versie zonder frontend.
mkdirSync('dist/dashboard', { recursive: true });

for (const file of ['index.html', 'app.js', 'editor.js', 'ui.js', 'clan.js']) {
  cpSync(`src/dashboard/${file}`, `dist/dashboard/${file}`);
}

console.log('dashboardbestanden gekopieerd naar dist/dashboard/');
