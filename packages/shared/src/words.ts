/**
 * Default word pool. Kept in `shared` so the client can validate a custom word
 * list against the same rules the server uses, but note that word *selection*
 * happens on the server only — the client never receives the pool for a live
 * round.
 */
export const WORDS: readonly string[] = [
  // objects
  'anchor', 'balloon', 'bicycle', 'blender', 'bucket', 'camera', 'candle',
  'clock', 'compass', 'crayon', 'drum', 'envelope', 'feather', 'guitar',
  'hammer', 'helmet', 'kettle', 'kite', 'ladder', 'lantern', 'mailbox',
  'mirror', 'needle', 'padlock', 'paintbrush', 'parachute', 'pencil', 'piano',
  'pillow', 'scissors', 'skateboard', 'spoon', 'suitcase', 'telescope',
  'toaster', 'toothbrush', 'trumpet', 'umbrella', 'vacuum', 'wallet',
  'watering can', 'wheelbarrow', 'windmill', 'yo-yo', 'zipper',

  // animals
  'alligator', 'butterfly', 'camel', 'chameleon', 'dolphin', 'dragonfly',
  'elephant', 'flamingo', 'giraffe', 'hedgehog', 'hippo', 'jellyfish',
  'kangaroo', 'koala', 'lobster', 'narwhal', 'octopus', 'ostrich', 'panda',
  'peacock', 'penguin', 'porcupine', 'rhinoceros', 'scorpion', 'seahorse',
  'sloth', 'snail', 'squirrel', 'starfish', 'tiger', 'turtle', 'walrus',
  'zebra',

  // food
  'avocado', 'bagel', 'broccoli', 'burrito', 'cupcake', 'doughnut',
  'dumpling', 'gingerbread', 'hamburger', 'ice cream', 'lollipop', 'mushroom',
  'noodles', 'pancake', 'pineapple', 'pizza', 'popcorn', 'pretzel',
  'sandwich', 'spaghetti', 'strawberry', 'sushi', 'taco', 'waffle',
  'watermelon',

  // places & nature
  'beach', 'cactus', 'campfire', 'castle', 'cave', 'desert', 'forest',
  'glacier', 'igloo', 'island', 'lighthouse', 'mountain', 'pyramid',
  'rainbow', 'skyscraper', 'tornado', 'volcano', 'waterfall',

  // people & characters
  'astronaut', 'chef', 'clown', 'cowboy', 'detective', 'firefighter',
  'knight', 'mermaid', 'ninja', 'pirate', 'robot', 'scarecrow', 'superhero',
  'vampire', 'wizard', 'zombie',

  // vehicles
  'ambulance', 'bulldozer', 'canoe', 'helicopter', 'hot air balloon',
  'motorcycle', 'rocket', 'sailboat', 'submarine', 'tractor', 'train',
  'tricycle',

  // actions & concepts
  'birthday', 'dancing', 'earthquake', 'fishing', 'gravity', 'juggling',
  'karate', 'nightmare', 'sneezing', 'snoring', 'surfing', 'tickle',
  'tug of war', 'whisper', 'yawning',

  // misc
  'bandage', 'barcode', 'battery', 'cobweb', 'dice', 'dominoes', 'fingerprint',
  'fireworks', 'fossil', 'hourglass', 'jigsaw', 'keyhole', 'magnet', 'maze',
  'origami', 'pinwheel', 'shadow', 'skeleton', 'snowflake', 'stethoscope',
  'sundial', 'tattoo', 'thermometer', 'treasure', 'trophy', 'tuxedo',
  'wishbone',
]
