// scales.config.js
// Control panel / manifest for the Scale Machine.
// No logic here — just data the app reads.

(function () {
  // 12 concert keys in semitone order (C up to B)
  const ROW_KEYS = ['Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A'];

  // All 12 major keys with:
  // - name: label to display
  // - pc: pitch class (0 = C, 1 = C#/Db, ... 11 = B)
  // - scale: spelled note names (no octaves) for a one-octave major scale
  const MAJOR_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'G', 'A', 'Bb', 'C', 'D', 'E', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'A', 'B', 'C', 'D', 'E', 'F#', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#', 'B'] },
  ];

  // Natural minor scales for each tonic.
  // scale: natural minor (Aeolian) starting on that tonic
  const NATURAL_MINOR_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bbb', 'Cb', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'E', 'F', 'G', 'A', 'Bb', 'C', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'F', 'Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F#', 'G', 'A', 'B', 'C', 'D', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'G', 'Ab', 'Bb', 'C', 'Db', 'Eb', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Ab', 'Bbb', 'Cb', 'Db', 'Ebb', 'Fb', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'A', 'Bb', 'C', 'D', 'Eb', 'F', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Bb', 'Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C#', 'D', 'E', 'F#', 'G', 'A', 'B'] },
  ];

  // Jazz minor (melodic minor ascending) scales for each tonic.
  // 1 2 b3 4 5 6 7
  const JAZZ_MINOR_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'D', 'Eb', 'F', 'G', 'A', 'B', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb', 'C', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'E', 'F', 'G', 'A', 'B', 'C#', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'F', 'Gb', 'Ab', 'Bb', 'C', 'D', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F#', 'G', 'A', 'B', 'C#', 'D#', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'G', 'Ab', 'Bb', 'C', 'D', 'E', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Ab', 'Bbb', 'Cb', 'Db', 'Eb', 'F', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'A', 'Bb', 'C', 'D', 'E', 'F#', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F', 'G', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'B', 'C', 'D', 'E', 'F#', 'G#', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'C', 'Db', 'Eb', 'F', 'G', 'A', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C#', 'D', 'E', 'F#', 'G#', 'A#', 'B'] },
  ];

    // Harmonic minor: 1 2 b3 4 5 b6 7
  const HARMONIC_MINOR_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'B', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bbb', 'C', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'E', 'F', 'G', 'A', 'Bb', 'C#', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'F', 'Gb', 'Ab', 'Bb', 'Cb', 'D', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F#', 'G', 'A', 'B', 'C', 'D#', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'G', 'Ab', 'Bb', 'C', 'Db', 'E', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Ab', 'Bbb', 'Cb', 'Db', 'Ebb', 'F', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'A', 'Bb', 'C', 'D', 'Eb', 'F#', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Bb', 'Cb', 'Db', 'Eb', 'Fb', 'G', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'B', 'C', 'D', 'E', 'F', 'G#', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'A', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C#', 'D', 'E', 'F#', 'G', 'A#', 'B'] },
  ];

  // Dorian: 1 2 b3 4 5 6 b7
  const DORIAN_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb', 'Cb', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'E', 'F', 'G', 'A', 'B', 'C', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'F', 'Gb', 'Ab', 'Bb', 'C', 'Db', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F#', 'G', 'A', 'B', 'C#', 'D', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'G', 'Ab', 'Bb', 'C', 'D', 'Eb', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Ab', 'Bbb', 'Cb', 'Db', 'Eb', 'Fb', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'A', 'Bb', 'C', 'D', 'E', 'F', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F', 'Gb', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'B', 'C', 'D', 'E', 'F#', 'G', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'C', 'Db', 'Eb', 'F', 'G', 'Ab', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C#', 'D', 'E', 'F#', 'G#', 'A', 'B'] },
  ];

  // Mixolydian: 1 2 3 4 5 6 b7
  const MIXOLYDIAN_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'Cb', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'E', 'F#', 'G', 'A', 'B', 'C', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'Db', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'G', 'A', 'Bb', 'C', 'D', 'Eb', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'Fb', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A', 'B'] },
  ];

    // Minor pentatonic: 1 b3 4 5 b7
  const MINOR_PENT_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'Eb', 'F', 'G', 'Bb', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Fb', 'Gb', 'Ab', 'Cb', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'F', 'G', 'A', 'C', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'Gb', 'Ab', 'Bb', 'Db', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'G', 'A', 'B', 'D', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'Ab', 'Bb', 'C', 'Eb', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Bbb', 'Cb', 'Db', 'Fb', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'Bb', 'C', 'D', 'F', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Cb', 'Db', 'Eb', 'Gb', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'C', 'D', 'E', 'G', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'Db', 'Eb', 'F', 'Ab', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'D', 'E', 'F#', 'A', 'B'] },
  ];

  // Blues scale: 1 b3 4 b5 5 b7
  const BLUES_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'Eb', 'F', 'Gb', 'G', 'Bb', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Fb', 'Gb', 'G', 'Ab', 'Cb', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'F', 'G', 'Ab', 'A', 'C', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'Gb', 'Ab', 'A', 'Bb', 'Db', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'G', 'A', 'Bb', 'B', 'D', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'Ab', 'Bb', 'B', 'C', 'Eb', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Bbb', 'Cb', 'C', 'Db', 'Fb', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'Bb', 'C', 'Db', 'D', 'F', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Cb', 'Db', 'D', 'Eb', 'Gb', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'C', 'D', 'Eb', 'E', 'G', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'Db', 'Eb', 'E', 'F', 'Ab', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'D', 'E', 'F', 'F#', 'A', 'B'] },
  ];

  // Whole tone: 1 2 3 #4 #5 b7 (here as 6-note with octave)
  const WHOLE_TONE_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'D', 'E', 'F#', 'G#', 'A#', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'Eb', 'F', 'G', 'A', 'B', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'E', 'F#', 'G#', 'A#', 'C', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'F', 'G', 'A', 'B', 'C#', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F#', 'G#', 'A#', 'C', 'D', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'G', 'A', 'B', 'C#', 'D#', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'Ab', 'Bb', 'C', 'D', 'E', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'A', 'B', 'C#', 'D#', 'F', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'Bb', 'C', 'D', 'E', 'F#', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'B', 'C#', 'D#', 'F', 'G', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'C', 'D', 'E', 'F#', 'G#', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C#', 'D#', 'F', 'G', 'A', 'B'] },
  ];

  // Half–whole diminished (H–W dim): 1 b2 #2 3 #4 5 6 b7
  const HALF_WHOLE_DIM_KEYS = [
    { name: 'C',  pc: 0,  scale: ['C', 'Db', 'D#', 'E', 'F#', 'G', 'A', 'Bb', 'C'] },
    { name: 'Db', pc: 1,  scale: ['Db', 'D', 'E', 'F', 'G', 'Ab', 'Bb', 'B', 'Db'] },
    { name: 'D',  pc: 2,  scale: ['D', 'Eb', 'F', 'F#', 'G#', 'A', 'B', 'C', 'D'] },
    { name: 'Eb', pc: 3,  scale: ['Eb', 'E', 'F#', 'G', 'A', 'Bb', 'C', 'Db', 'Eb'] },
    { name: 'E',  pc: 4,  scale: ['E', 'F', 'G', 'G#', 'A#', 'B', 'C#', 'D', 'E'] },
    { name: 'F',  pc: 5,  scale: ['F', 'Gb', 'G#', 'A', 'B', 'C', 'D', 'Eb', 'F'] },
    { name: 'Gb', pc: 6,  scale: ['Gb', 'G', 'A', 'Bb', 'Cb', 'Db', 'Eb', 'E', 'Gb'] },
    { name: 'G',  pc: 7,  scale: ['G', 'Ab', 'Bb', 'B', 'C#', 'D', 'E', 'F', 'G'] },
    { name: 'Ab', pc: 8,  scale: ['Ab', 'A', 'B', 'C', 'D', 'Eb', 'F', 'Gb', 'Ab'] },
    { name: 'A',  pc: 9,  scale: ['A', 'Bb', 'C', 'C#', 'D#', 'E', 'F#', 'G', 'A'] },
    { name: 'Bb', pc: 10, scale: ['Bb', 'B', 'C#', 'D', 'E', 'F', 'G', 'Ab', 'Bb'] },
    { name: 'B',  pc: 11, scale: ['B', 'C', 'D', 'D#', 'F', 'F#', 'G#', 'A', 'B'] },
  ];

  // Transposition options (time-zone style)
  // offset = how many semitones ABOVE concert the WRITTEN note is.
  const TRANSPOSITIONS = [
    {
      id: 'c_treble',
      label: 'C instruments (treble clef)',
      offset: 0,
      clef: 'treble',
    },
    {
      id: 'c_bass',
      label: 'C instruments (bass clef)',
      offset: 0,
      clef: 'bass',
    },
    {
      id: 'bb',
      label: 'B♭ instruments',
      offset: 2, // written note is a major 2nd above concert
      clef: 'treble',
    },
    {
      id: 'eb',
      label: 'E♭ instruments',
      offset: -3, // written note is a major 6th above concert, or minor 3rd below
      clef: 'treble',
    },
    {
      id: 'f',
      label: 'F instruments',
      offset: 7, // written note is a perfect 5th above concert
      clef: 'treble',
    },
  ];

    // Smart Listening Mode configuration
  // 16-slot rhythm pattern: 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2
  const LISTEN_PATTERN = [2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2];

  // Default tempo for listen mode (you can tweak this later)
  const LISTEN_DEFAULT_BPM = 72;

  // Minimum RMS level for considering a frame "real sound" vs noise
  // (rough starting point; can be adjusted after real-world testing)
  const LISTEN_MIN_RMS = 0.01;


     const SCALE_TYPES = [
    {
      id: 'major',
      label: 'Major',
      mode: 'major',
    },
    {
      id: 'naturalMinor',
      label: 'Natural minor',
      mode: 'naturalMinor',
    },
    {
      id: 'jazzMinor',
      label: 'Jazz minor (melodic asc.)',
      mode: 'jazzMinor',
    },
    {
      id: 'harmonicMinor',
      label: 'Harmonic minor',
      mode: 'harmonicMinor',
    },
    {
      id: 'dorian',
      label: 'Dorian',
      mode: 'dorian',
    },
    {
      id: 'mixolydian',
      label: 'Mixolydian',
      mode: 'mixolydian',
    },
    {
      id: 'minorPent',
      label: 'Minor pentatonic',
      mode: 'minorPent',
    },
    {
      id: 'blues',
      label: 'Blues',
      mode: 'blues',
    },
    {
      id: 'wholeTone',
      label: 'Whole tone',
      mode: 'wholeTone',
    },
    {
      id: 'halfWholeDim',
      label: 'Half–whole diminished',
      mode: 'halfWholeDim',
    },
  ];

    // Expose as a single config object on window so scales.app.js (and listen mode) can read it.
  window.SCALE_CONFIG = {
    ROW_KEYS,
    MAJOR_KEYS,
    NATURAL_MINOR_KEYS,
    JAZZ_MINOR_KEYS,
    HARMONIC_MINOR_KEYS,
    DORIAN_KEYS,
    MIXOLYDIAN_KEYS,
    MINOR_PENT_KEYS,
    BLUES_KEYS,
    WHOLE_TONE_KEYS,
    HALF_WHOLE_DIM_KEYS,
    TRANSPOSITIONS,
    SCALE_TYPES,
    LISTEN_PATTERN,
    LISTEN_DEFAULT_BPM,
    LISTEN_MIN_RMS,
  };
})();