import { readFileSync } from 'fs';
import { parseWorkbook } from './src/lib/workbook/parse';
const env: Record<string,string> = {};
for (const l of readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim();}
const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/workbook_data?select=sheets&limit=1`,
  { headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY!,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
const d = await r.json();
const p = parseWorkbook(d[0].sheets);
console.log('library      :', p.library.length);
console.log('benchmarks   :', p.benchmarks.length, '| placeholders:', p.benchmarks.filter(b=>b.isPlaceholder).length);
console.log('taskTemplates:', p.taskTemplates.length);
console.log('aiContext    :', p.aiContext.length);
console.log('\n-- sample library:');
p.library.slice(0,3).forEach(l=>console.log('  ',l.initiativeKey,'| diff',l.difficulty,'| ops',l.ownOrOps,'|',l.name));
console.log('\n-- webinar benchmarks (fractions):');
p.benchmarks.filter(b=>b.initiativeKey==='webinar').slice(0,3).forEach(b=>console.log('  ',b.metric,'->',b.conservative,b.moderate,b.aggressive,'| ph:',b.isPlaceholder));
console.log('\n-- email open rate (was 0.3 decimal):');
p.benchmarks.filter(b=>/open rate/i.test(b.metric)).forEach(b=>console.log('  ',b.initiativeKey,b.metric,'->',b.conservative,b.moderate,b.aggressive));
console.log('\n-- live-webinar tasks (first 5, lead days):');
p.taskTemplates.filter(t=>t.initiativeKey==='live-webinar').slice(0,5).forEach(t=>console.log('  #'+t.taskNumber,'lead',t.leadDays+'d','dur',t.durationHours+'h','dep',JSON.stringify(t.dependsOn),'|',t.name.slice(0,40)));
console.log('\n-- template keys:', [...new Set(p.taskTemplates.map(t=>t.initiativeKey))].join(', '));
console.log('\n-- WARNINGS:'); p.warnings.forEach(w=>console.log('  !',w));
