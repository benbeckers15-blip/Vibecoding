const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./winery_classifications_all.json'));

// Manual mapping: generated ID → actual Firestore doc ID
const corrections = {
  'after-hours-wine-and-gindong-gin':                      'after-hours-wine',
  'capel-vale-wines-&-cellar-door':                        'capel-vale-winery',
  'cherubino-cellar-door-&-guest-houses':                  'cherubino-cellar-door-&-guesthouse',
  'domaine-naturaliste':                                   'domain-naturaliste',
  'happs-wines-&-commonage-pottery':                       'happs-wine-&-commonage-pottery',
  'lamont\'s':                                             'lamonts',
  'l.a.s.-vino':                                           'las-vino',
  'settlers-ridge-organic-wines---tastings-by-appointment-only': 'settlers-ridge-organic-wines',
  'south-by-south-west-wines':                             'south-by-south-west',
  'swings-&-roundabouts-yallingup':                        'swings-&-roundabouts',
  'vallée-du-venom---cellar-door':                         'vallée-du-venom---cellar-door',
  'wayfinder-wine-bar-&-restaurant':                       'wayfinder-cellar-door-&-restaurant',
  'willespie-estate':                                      'willespie',
  'wise-wine-cellar-door-|-eagle-bay':                     'wise-wine',
  'woody-nook-pty-ltd':                                    'woody-nook-wines',
};

// Wineries in classifications but NOT in Firestore — flag these
const inFirestore = new Set([
  'ad-hoc-by-cherubino','after-hours-wine','altair-estate','amato-vino',
  'amelia-park-wines','aravina-estate','barnyard1978','bettenays-margaret-river-wine-&-nougat',
  'borello-vineyards','brown-hill-estate','cape-grace-wines','cape-mentelle',
  'cape-naturaliste-vineyard','capel-vale-winery','cherubino-cellar-door-&-guesthouse',
  'churchview-estate','clairault-streicker','coward-and-black-vineyards',
  'credaro-family-estate','cullen-wines','deep-woods-estate','di-latte-estate',
  'domain-naturaliste','dormilona','driftwood-estate','edwards-wines','evans-&-tate',
  'evoi-wines','fermoy-estate','firetail-wines','fishbone-wines','flametree-wines',
  'flowstone-wines','fraser-gallop-estate','glenarty-road','goon-tycoons','grace-farm',
  'gralyn-estate','hamelin-bay-wines','happs-wine-&-commonage-pottery','hay-shed-hill-wines',
  'house-of-cards-wine','howard-park-wines','jarvis-estate','jilyara','juniper-wines',
  'knotting-hill-estate','lamonts','las-vino','leeuwin-estate',
  'lentedal-winery-&-wood-fired-pizza-cafe','lenton-brae','ls-merchants','marq-wines',
  'mongrel-creek-wines-margaret-river','moss-wood','mr-barval-fine-wines',
  'palmer-wine-cellar-door','passel-estate','peacetree-wines','pierro','redgate-wines',
  'rivendell-winery-estate','rosa-glen-farm','rosily-vineyard',
  'settlers-ridge-organic-wines','si-vintners','skigh-wine','snake-+-herring',
  'south-by-south-west','stella-bella-wines','stormflower-vineyard','subsea-estate',
  'swings-&-roundabouts','the-berry-farm','the-valley-margaret-river','thompson-estate',
  'vallée-du-venom---cellar-door','vasse-felix','victory-point-wines','voyager-estate',
  'walsh-&-sons','wayfinder-cellar-door-&-restaurant','whicher-ridge-wines','willespie',
  'wills-domain','windance-estate-wines','windows-estate','wise-wine','woody-nook-wines',
  'xanadu-wines'
]);

const updated = data.map(w => {
  let docId = w.firestore_doc_id;
  if (corrections[docId]) docId = corrections[docId];
  return { ...w, firestore_doc_id: docId };
});

// Report
console.log('\n📋 Final mapping:\n');
updated.forEach(w => {
  const exists = inFirestore.has(w.firestore_doc_id);
  const flag = exists ? '✅' : '⚠️  NOT IN FIRESTORE';
  console.log(`  ${flag} ${w.title} → ${w.firestore_doc_id}`);
});

fs.writeFileSync('./winery_classifications_all.json', JSON.stringify(updated, null, 2));
console.log('\n✅ Saved updated winery_classifications_all.json');