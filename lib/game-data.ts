export const categories = {
  animals: ['tiger', 'rabbit', 'turtle', 'elephant', 'tapir', 'rhino', 'otter', 'rat', 'toucan', 'newt', 'termite', 'eagle', 'emu', 'urchin', 'narwhal', 'lemur', 'raccoon', 'nightingale', 'eel', 'lion', 'leopard', 'dog', 'goat', 'gecko', 'owl', 'wolf', 'fox', 'yak', 'koala', 'ant', 'ape', 'bear', 'beaver', 'buffalo', 'camel', 'cat', 'cheetah', 'cobra', 'crow', 'deer', 'dolphin', 'donkey', 'duck', 'falcon', 'ferret', 'frog', 'giraffe', 'gorilla', 'hamster', 'hare', 'hawk', 'horse', 'hyena', 'ibis', 'iguana', 'jackal', 'jaguar', 'jellyfish', 'kangaroo', 'kiwi', 'llama', 'lobster', 'lynx', 'mole', 'monkey', 'moose', 'mouse', 'octopus', 'orca', 'ostrich', 'panda', 'panther', 'parrot', 'penguin', 'pig', 'puma', 'quail', 'seal', 'shark', 'sheep', 'sloth', 'snake', 'squid', 'swan', 'toad', 'turkey', 'vulture', 'walrus', 'whale', 'wombat', 'zebra'],
  food: ['taco', 'omelette', 'enchilada', 'apple', 'egg', 'grape', 'edamame', 'eclair', 'rice', 'empanada', 'avocado', 'orange', 'noodles', 'samosa', 'almond', 'donut', 'toast', 'tomato', 'olive', 'waffle', 'lasagna', 'nachos', 'sushi', 'idli', 'icecream', 'mango', 'okra', 'asparagus', 'salad', 'dumpling', 'garlic', 'carrot', 'ramen', 'nutmeg', 'guava', 'apricot', 'tea', 'espresso', 'onion', 'nectarine', 'hummus', 'sandwich', 'honey', 'yogurt', 'burger', 'raspberry', 'yam', 'melon', 'kiwi', 'jalapeno', 'pasta', 'pizza', 'quinoa', 'brownie', 'burrito', 'coconut', 'croissant', 'curry', 'falafel', 'fig', 'kebab', 'lemon', 'lentil', 'muffin', 'papaya', 'peach', 'pear', 'pickle', 'potato', 'pudding', 'spinach', 'stew', 'vanilla'],
  countries: ['india', 'argentina', 'australia', 'austria', 'angola', 'albania', 'armenia', 'andorra', 'egypt', 'estonia', 'ecuador', 'eritrea', 'ethiopia', 'england', 'denmark', 'dominica', 'djibouti', 'italy', 'indonesia', 'iran', 'iraq', 'ireland', 'iceland', 'israel', 'laos', 'latvia', 'lebanon', 'libya', 'lithuania', 'luxembourg', 'mexico', 'malaysia', 'maldives', 'malta', 'mali', 'morocco', 'nepal', 'norway', 'nigeria', 'namibia', 'niger', 'oman', 'pakistan', 'panama', 'paraguay', 'peru', 'poland', 'portugal', 'qatar', 'romania', 'russia', 'rwanda', 'spain', 'sweden', 'switzerland', 'serbia', 'singapore', 'somalia', 'sudan', 'thailand', 'tunisia', 'turkey', 'uganda', 'ukraine', 'uruguay', 'vietnam', 'yemen', 'zambia', 'zimbabwe', 'brazil', 'belgium', 'belarus', 'belize', 'bhutan', 'bolivia', 'botswana', 'bulgaria', 'cambodia', 'cameroon', 'canada', 'chad', 'chile', 'china', 'colombia', 'croatia', 'cuba', 'cyprus', 'france', 'finland', 'fiji', 'gabon', 'gambia', 'georgia', 'germany', 'ghana', 'greece', 'guyana', 'haiti', 'hungary', 'japan', 'jamaica', 'jordan', 'kenya', 'kuwait'],
  things: ['table', 'eraser', 'radio', 'oven', 'notebook', 'key', 'yoyo', 'orange', 'envelope', 'engine', 'earphone', 'easel', 'lamp', 'pencil', 'laptop', 'phone', 'earring', 'guitar', 'ring', 'glass', 'spoon', 'needle', 'eraser', 'ruler', 'rope', 'egg', 'globe', 'umbrella', 'anchor', 'robot', 'towel', 'wallet', 'watch', 'chair', 'camera', 'clock', 'candle', 'bottle', 'basket', 'brush', 'book', 'button', 'box', 'backpack', 'mirror', 'magnet', 'mug', 'newspaper', 'pillow', 'plate', 'poster', 'printer', 'scissors', 'shoe', 'soap', 'suitcase', 'ticket', 'toothbrush', 'vase'],
} as const;

export type Category = keyof typeof categories;

export function normalizeWord(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z]/g, '');
}

export function isValidWord(category: Category, word: string) {
  return (categories[category] as readonly string[]).includes(normalizeWord(word));
}

export function isWellFormedWord(value: string) {
  return /^[a-z]{2,32}$/i.test(value.trim());
}

export const blockedWords = new Set(['ass', 'arse', 'bastard', 'bitch', 'cunt', 'damn', 'dick', 'fag', 'fuck', 'nigger', 'piss', 'shit', 'slut', 'whore']);

export function isBlockedWord(word: string) {
  return blockedWords.has(normalizeWord(word));
}

export function isValidCategoryWord(category: Category, value: string) {
  return isWellFormedWord(value) && !isBlockedWord(value) && isValidWord(category, value);
}

export function getWords(category: Category, letter: string, used: string[] = []) {
  const usedSet = new Set(used.map(normalizeWord));
  return (categories[category] as readonly string[]).filter((word) => word.startsWith(letter.toLowerCase()) && !usedSet.has(word));
}
