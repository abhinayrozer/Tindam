'use strict';

// Maps every food/meal to an emoji glyph, which the icon build step resolves
// to a bundled Twemoji SVG. Rules are ordered: first match wins. Raw
// ingredients match on specific produce words; prepared dishes match on
// dish-type words.

const RAW_RULES = [
  // fruits
  ['🍍', /pineapple|ananas/], ['🍌', /banana|plantain|kela/], ['🥭', /mango|aam|kairi/],
  ['🍉', /watermelon|tarbuj|tarbooz/], ['🍊', /orange|santra|kinnow|mosambi|sweet lime|tangerine|grapefruit|pomelo|chakotra|persimmon/],
  ['🍋', /lemon|nimbu|lime,/], ['🍇', /grape|angoor|raisin|kishmish|munakka|currant|fig|anjeer/],
  ['🥝', /kiwi/], ['🍐', /pear|nashpati/], ['🍑', /peach|aadu|aroo|plum|apricot|khubani|khoomani|alubokhara|aloo bukhara/],
  ['🍒', /cherr|litchi|lichi|longan|rambutan|pomegranate|anaar|anar|karonda|phalsa|falsa/],
  ['🍓', /strawberr/], ['🫐', /blueberr|blackberr|raspberr|mulberr|shahtoot|jamun|jambu|ber |jujube|zizyphus|cranberr/],
  ['🍎', /apple, |apple \/|^apple|wood apple|bael|custard apple|sitaphal|sharifa|ramphal|soursop|rose apple/],
  ['🥥', /coconut|nariyal|copra|tadgola|ice apple|palm fruit|neera/],
  ['🌴', /date|khajur|chuhara/], ['🥑', /avocado|makhanphal/],
  ['⭐', /starfruit|star fruit|kamrakh/], ['🍏', /amla|gooseberr|loquat|guava|amrud|amrood/],
  ['🍈', /papaya|papita|melon|kharbooja|chikoo|sapota|jackfruit|jack fruit|kathal|passion|dragon|bel |tamarind/],
  ['🌰', /water chestnut|singhara|almond|cashew|kaju|pista|walnut|akhrot|hazel|brazil|chilgoza|pine nut|chironji|nut(s)? |badam/],
  // vegetables
  ['🍅', /tomato/], ['🍠', /sweet potato|shakarkandi|beet|yam|suran|arbi|taro|colocasia/],
  ['🥔', /potato|aloo/], ['🧅', /onion|pyaz|leek|spring onion/], ['🧄', /garlic|lahsun/],
  ['🫚', /ginger|adrak|turmeric|haldi/], ['🥕', /carrot|gajar|radish|mooli|turnip|shalgam|kohlrabi/],
  ['🥦', /broccoli|cauliflower|gobi|gobhi/], ['🥒', /cucumber|kheera|zucchini|gourd|lauki|karela|parwal|tinda|turai|kundru|petha|chichinda|chayote|chow chow/],
  ['🍆', /brinjal|baingan|eggplant/], ['🌽', /corn|bhutta|maize|makki/], ['🍄', /mushroom/],
  ['🌶️', /chilli|mirchi(?!.*shimla)|red chill|green chill/], ['🫑', /capsicum|bell pepper|shimla/],
  ['🫛', /peas|matar|beans, |french bean|cluster|gawar|broad bean|sem |drumstick|okra|bhindi|lobia|edamame/],
  ['🎃', /pumpkin|kaddu/], ['🥬', /spinach|palak|methi leaves|saag|bathua|chaulai|kale|lettuce|cabbage|patta gobi|leaves|arugula|celery|bok choy|asparagus|banana flower|bamboo|lotus stem|keerai/],
  ['🌿', /mint|pudina|coriander|dhaniya|basil|lemongrass|curry leaf|moringa|wheatgrass|aloe vera|spirulina|stevia/],
  // pulses & grains
  ['🌱', /sprout/], ['🫘', /dal|lentil|rajma|chana|chickpea|moong|urad|masoor|toor|arhar|moth|matki|horse gram|kulthi|soybean|soya|cowpea|lima|val |field bean|legume|besan|sattu/],
  ['🍚', /rice|poha|murmura|sabudana|sago|idli rice/], ['🍞', /bread|toast/],
  ['🥣', /oats|muesli|granola|porridge|corn flakes|bran|dalia|daliya/],
  ['🍝', /pasta|noodle|vermicelli|sevai|macaroni/],
  ['🌾', /wheat|atta|flour|sooji|rava|semolina|millet|jowar|bajra|ragi|quinoa|barley|jau|amaranth|rajgira|buckwheat|kuttu|psyllium|isabgol|khakhra|germ/],
  // dairy / protein
  ['💪', /whey|protein powder|protein isolate|casein|nutritional yeast|mass gainer/],
  ['🥛', /milk(?!\s*fish)|buttermilk|chaas|lassi|kefir/], ['🧀', /paneer|cheese|chhena|khoya|mozzarella/],
  ['🧈', /butter$|butter |ghee|cream|tofu|tempeh|makhan/],
  // eggs, meat, fish
  ['🍳', /yolk|omelette|bhurji/], ['🥚', /egg/],
  ['🍗', /chicken|poultry|murgh|turkey|duck|quail/],
  ['🥩', /mutton|goat|sheep|lamb|pork|beef|calf|meat|keema|liver|kidney|brain/],
  ['🦐', /prawn|shrimp/], ['🦀', /crab/], ['🦑', /squid|octopus|calamari|cuttle/],
  ['🐟', /fish|salmon|tuna|sardine|mackerel|rohu|katla|hilsa|pomfret|surmai|rawas|anchovy|nethili|basa|tilapia|seer|bangda|roe|mathi|shellfish|clam|mussel|oyster|snail/],
  ['🌭', /sausage/],
  // seeds & snacks
  ['🍿', /makhana|fox nut|puffed|puffs/], ['🥜', /peanut|groundnut|moongphali/],
  ['🌻', /sunflower|chia|flax|alsi|sesame|til |pumpkin seed|magaz|melon seed|sabja|basil seed|hemp|seeds/],
  // drinks
  ['☕', /coffee|espresso|kaapi/], ['🍵', /tea|chai|kashaya|green tea/],
  ['🧃', /juice|sharbat|panna|sherbet|lemonade|jaljeera|panakam|cooler|water$|ambli|kanji|kombucha|drink/],
  ['🥤', /shake|smoothie|thandai|malt|soda/],
  ['💧', /^drinking water/],
  // fats, sweeteners, spices
  ['🫒', /oil$|oil |olive/], ['🍯', /honey|jaggery|gur|maple|syrup/], ['🍫', /chocolate|cocoa|cacao/],
  ['🍬', /sugar|candy/], ['🧂', /salt|masala powder|powder|cardamom|clove|pepper|jeera|cumin|mustard seed|fenugreek seed|ajwain|asafoetida|hing|spice|kokum|tamarind/]
];

const DISH_RULES = [
  ['🍳', /omelette|bhurji|egg white|anda/], ['🍗', /chicken|tangdi|murgh|duck|quail|turkey/],
  ['🐟', /fish|meen|machher|ilish|maach|pollichathu|surmai|tuna|salmon|recheado|moilee/],
  ['🦐', /prawn|chingri|shrimp/], ['🥩', /mutton|keema|galouti|rogan|yakhni|nihari|pork|vindaloo|pandi|paya|dalcha|liver/],
  ['🥚', /egg/],
  ['🥤', /shake|smoothie|lassi|thandai|malt/], ['🧃', /juice|sharbat|drink|cooler|water|kadhi?$/],
  ['🥟', /momo|dumpling/], ['🍩', /vada|bonda/], ['🧆', /falafel|kabab|kebab|kofta|cutlet|tikki|shami|seekh|meatball/],
  ['🍢', /tikka|tandoori|skewer|grill|roast|65|sukka|ghee roast|fry|kathi.*paneer|paneer kathi/],
  ['🥙', /roll|wrap|burrito|frankie|shawarma/], ['🥪', /sandwich|toast/],
  ['🥞', /pancake|uttapam|appam|cheela/], ['🫓', /dosa|chilla|roti|paratha|phulka|naan|thepla|bhakri|kulcha|khakhra|thalipeeth|parotta|adai|pesarattu|paniyaram|puttu|idiyappam|mathri|papad/],
  ['🍥', /idli|dhokla|khaman|muthiya|patra|khandvi|sandwich dhokla/],
  ['🍮', /kheer|halwa|ladoo|laddu|chikki|barfi|custard|shrikhand|mishti|pudding|payasam|phirni|dessert|poli|sheera|jalebi/],
  ['🍫', /chocolate|brownie/], ['🍯', /honey/],
  ['🥣', /oats|porridge|dalia|daliya|muesli|granola|smoothie bowl|parfait|overnight/],
  ['🥗', /salad|chaat|bhel|sundal|kachumber|koshimbir|sprout|raita|bowl$|bowl /],
  ['🍲', /soup|shorba|rasam|stew|ishtu|kadhi|kuzhambu|saar|thukpa|dal |dalma|pappu|sambar|amti|usal|ghugni|kootu|erissery|pulissery|olan|theeyal/],
  ['🍚', /rice|pulao|biryani|khichdi|khichuri|pongal|bath|sevai|semiya|upma|poha|dahi chura|kappa/],
  ['🍿', /makhana|chivda|jor garam|puffs|chips|bhutta/],
  ['🍛', /curry|masala|korma|makhanwala|makhani|lababdar|do pyaza|jalfrezi|kolhapuri|chettinad|xacuti|cafreal|salan|bharta|sabzi|saag|poriyal|thoran|bhaji|shukto|labra|santula|chokha|posto|dalna|gatte|sangri|undhiyu|nimona|avial|musallam|korma|handi|litti|zunka|pithla|haleem|pav|misal|ragda|hummus|thali|bhindi|gobi|aloo|baingan|paneer|mushroom|kofta|veg |kadala|matar/]
];

function glyphFor(item) {
  const name = (item.name || '').toLowerCase();
  const category = item.category || '';
  const rules = /Prepared|Miscellaneous/.test(category) ? [...DISH_RULES, ...RAW_RULES] : RAW_RULES;
  for (const [emoji, re] of rules) {
    if (re.test(name)) return emoji;
  }
  // category fallbacks
  const fallback = {
    'Fruits': '🍎', 'Vegetables': '🥬', 'Grains & Cereals': '🌾',
    'Pulses, Dals & Legumes': '🫘', 'Dairy & Alternatives': '🥛',
    'Eggs, Chicken, Fish & Meat': '🍗', 'Nuts, Seeds & Dry Fruits': '🌰',
    'Shakes & Drinks': '🥤', 'Prepared Indian Meals': '🍛', 'Oils & Fats': '🫒',
    'Sweeteners & Condiments': '🍯', 'Spices & Condiments': '🧂', 'Miscellaneous': '🍽️'
  };
  return fallback[category] || '🍽️';
}

// Twemoji filename for an emoji: hyphen-joined hex codepoints, VS16 stripped.
function twemojiFile(emoji) {
  return [...emoji]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((c) => c !== 'fe0f')
    .join('-') + '.svg';
}

module.exports = { glyphFor, twemojiFile, RAW_RULES, DISH_RULES };
