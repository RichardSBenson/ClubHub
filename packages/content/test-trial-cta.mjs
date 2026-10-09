import { validate, renderBlocks } from './blocks.mjs';
import { documentFromText, textFromDocument } from './document-text.mjs';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗', n)); };
const html = (b) => renderBlocks({ blocks: [b] });

let r = validate({ blocks: [{ type: 'trialCta', heading: 'Try a class', text: 'First one is free.', button: 'Book now', club: 'whanganui', extra: 1 }] });
ok('the block is accepted, and an unknown field is dropped', r.doc.blocks.length === 1 && r.doc.blocks[0].club === 'whanganui' && r.dropped.length === 1);
ok('with a club it goes to that club\'s trial enquiry', /href="\/enquire\/whanganui\?kind=trial"/.test(html(r.doc.blocks[0])) && />Book now</.test(html(r.doc.blocks[0])));
ok('without a club it goes to the list of clubs', /href="\/find-a-club"/.test(html({ type: 'trialCta' })) && /Try a free class/.test(html({ type: 'trialCta' })));
ok('a club address that is not a slug is ignored', /href="\/find-a-club"/.test(html({ type: 'trialCta', club: '"><script>x' })) && !/script/.test(html({ type: 'trialCta', club: '"><script>x' })));
ok('words are escaped', !/<b>/.test(html({ type: 'trialCta', heading: '<b>hi</b>', text: '<i>x</i>' })));
ok('default button names the action', /Book a free class/.test(html({ type: 'trialCta', club: 'a' })) && /Find your nearest club/.test(html({ type: 'trialCta' })));

const text = '{{trial club=whanganui heading=Try_a_free_class text=First_one_is_free button=Book_now}}';
const doc = documentFromText(text);
ok('the editor\'s one box reads it', doc.blocks[0]?.type === 'trialCta' && doc.blocks[0].club === 'whanganui' && doc.blocks[0].heading === 'Try a free class' && doc.blocks[0].button === 'Book now');
const again = documentFromText(textFromDocument(doc));
ok('and it survives a round trip', JSON.stringify(again) === JSON.stringify(doc));
ok('a bare one round-trips too', JSON.stringify(documentFromText(textFromDocument(documentFromText('{{trial}}')))) === JSON.stringify(documentFromText('{{trial}}')));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
