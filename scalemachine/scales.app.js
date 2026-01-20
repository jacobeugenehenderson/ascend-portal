// scales.app.js
// Uses SCALE_CONFIG to populate dropdowns and render the 12-key grid as text.

(function () {
  const cfg = window.SCALE_CONFIG;
  if (!cfg) {
    console.error('SCALE_CONFIG not found. Make sure scales.config.js is loaded.');
    return;
  }

  const {
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
  } = cfg;

  const VF = (window.Vex && window.Vex.Flow) || null;

  // --- DOM helpers --------------------------------------------------------

  const $ = (selector) => document.querySelector(selector);

  const transpositionSelect = $('#transpositionSelect');
  const scaleTypeSelect = $('#scaleTypeSelect');
  const notationContainer = $('#scaleNotation');
  const gridStatus = $('#gridStatus');

  // Tuning overlay elements
  const tuningOverlay = $('#tuningOverlay');
  const tuningOverlaySelect = $('#tuningOverlaySelect');
  const tuningOverlayStart = $('#tuningOverlayStart');

  const TUNING_STORAGE_KEY = 'scaleMachine_selectedTuning';

  // --- Data helpers -------------------------------------------------------

  function findMajorKeyByName(name) {
    return MAJOR_KEYS.find((k) => k.name === name) || null;
  }

  function findMajorKeyByPc(pc) {
    return MAJOR_KEYS.find((k) => k.pc === pc) || null;
  }

  function findTranspositionById(id) {
    return TRANSPOSITIONS.find((t) => t.id === id) || null;
  }

  function findScaleTypeById(id) {
    return SCALE_TYPES.find((s) => s.id === id) || null;
  }

  function wrapPc(pc) {
    // ensure we stay in [0, 11]
    return ((pc % 12) + 12) % 12;
  }

  function findMinorKeyByName(name) {
    return NATURAL_MINOR_KEYS.find((k) => k.name === name) || null;
  }

    function findJazzMinorKeyByName(name) {
    return JAZZ_MINOR_KEYS.find((k) => k.name === name) || null;
  }

  function findHarmonicMinorKeyByName(name) {
    return HARMONIC_MINOR_KEYS.find((k) => k.name === name) || null;
  }

  function findDorianKeyByName(name) {
    return DORIAN_KEYS.find((k) => k.name === name) || null;
  }

  function findMixolydianKeyByName(name) {
    return MIXOLYDIAN_KEYS.find((k) => k.name === name) || null;
  }

    function findMinorPentKeyByName(name) {
    return MINOR_PENT_KEYS.find((k) => k.name === name) || null;
  }

  function findBluesKeyByName(name) {
    return BLUES_KEYS.find((k) => k.name === name) || null;
  }

  function findWholeToneKeyByName(name) {
    return WHOLE_TONE_KEYS.find((k) => k.name === name) || null;
  }

  function findHalfWholeDimKeyByName(name) {
    return HALF_WHOLE_DIM_KEYS.find((k) => k.name === name) || null;
  }

  // Given a one-octave scale as note names (no octaves),
  // add octave numbers based on clef and position.
  // v1 rule: start on C4/C2-ish and only bump the last note an octave up.
      const LETTER_TO_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

  function parseNoteName(name) {
    const m = name.match(/^([A-Ga-g])(b+|#+)?$/);
    if (!m) {
      return { letter: 'c', accidental: '' };
    }
    return {
      letter: m[1].toLowerCase(),
      accidental: m[2] || '',
    };
  }

  function pitchFromParts(letter, accidental, octave) {
    const basePc = LETTER_TO_PC[letter.toLowerCase()] ?? 0;
    let accOffset = 0;
    if (accidental) {
      if (accidental[0] === '#') {
        accOffset = accidental.length;      // #, ##, etc.
      } else {
        accOffset = -accidental.length;     // b, bb, etc.
      }
    }
    return octave * 12 + basePc + accOffset;
  }

  // Convert a note string like "C4" or "Db5" to a standard MIDI number,
  // aligned with the Web Audio mapping (A4 = 440 Hz -> MIDI 69).
  function noteNameToMidi(note) {
    const m = note.match(/^([A-Ga-g])(b+|#+)?(\d)$/);
    if (!m) return null;
    const letter = m[1].toLowerCase();
    const accidental = m[2] || '';
    const octave = Number(m[3]);
    const basePc = LETTER_TO_PC[letter] ?? 0;

    let accOffset = 0;
    if (accidental) {
      if (accidental[0] === '#') {
        accOffset = accidental.length;
      } else {
        accOffset = -accidental.length;
      }
    }
    const pc = basePc + accOffset;
    return (octave + 1) * 12 + pc;
  }

  function midiToFreq(midi) {
    if (typeof midi !== 'number') return null;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Ensure the scale always climbs in pitch before the final tonic.  
  // We assume noteNames is an 8-note scale: 1 2 3 4 5 6 7 8 (tonic repeated).
    function applyOctaves(noteNames, clef) {
    const baseOctave = clef === 'bass' ? 2 : 4;
    if (!noteNames || !noteNames.length) return [];

    const parsed = noteNames.map(parseNoteName);
    const result = [];

    let octave = baseOctave;
    let firstPitch = null;
    let lastPitch = null;

    // Degrees 1–7: strictly ascending
    for (let i = 0; i < parsed.length - 1; i++) {
      const { letter, accidental } = parsed[i];
      let pitch = pitchFromParts(letter, accidental, octave);

      // If this pitch would be at or below the previous, bump octave until it’s above.
      if (lastPitch !== null && pitch <= lastPitch) {
        while (pitch <= lastPitch) {
          octave += 1;
          pitch = pitchFromParts(letter, accidental, octave);
        }
      }

      if (firstPitch === null) firstPitch = pitch;
      lastPitch = pitch;

      result.push(`${letter.toUpperCase()}${accidental}${octave}`);
    }

    // Final tonic: exactly one octave above the first tonic.
    const last = parsed[parsed.length - 1];
    const baseFirstPitch =
      firstPitch ??
      pitchFromParts(last.letter, last.accidental, baseOctave);
    const topPitch = baseFirstPitch + 12;
    const topOctave = Math.floor(topPitch / 12);

    result.push(
      `${last.letter.toUpperCase()}${last.accidental}${topOctave}`
    );

    return result;
  }

  // Build an ascending + descending scale (up and down)
  // using the one-octave scale spelling and clef.
  function buildUpDownOctaveSequence(scaleNoteNames, clef) {
    const ascWithOctaves = applyOctaves(scaleNoteNames, clef);
    if (!ascWithOctaves.length) return [];
    const desc = ascWithOctaves.slice(0, -1).reverse();
    return ascWithOctaves.concat(desc);
  }

  function toVexKey(noteWithOctave) {
    const match = noteWithOctave.match(/^([A-Ga-g])(b+|#+)?(\d)$/);
    if (!match) {
      return { key: 'c/4', accidental: null };
    }
    const letter = match[1].toLowerCase();
    const accidental = match[2] || '';
    const octave = match[3];
    return {
      key: `${letter}/${octave}`,
      accidental: accidental || null,
    };
  }

    function createScaleNotes(noteOctaves, clef) {
    // Middle-line pitches for stem direction
    const middleTreble = pitchFromParts('b', '', 4); // B4 (treble middle line)
    const middleBass = pitchFromParts('d', '', 3);   // D3 (bass middle line)
    const middlePitch = clef === 'bass' ? middleBass : middleTreble;

    return noteOctaves.map((note) => {
      // Re-use our Vex key / accidental helper
      const { key, accidental } = toVexKey(note);

      // Parse the note to compute its pitch
      const m = note.match(/^([A-Ga-g])(b+|#+)?(\d)$/);
      const letter = (m?.[1] || 'c').toLowerCase();
      const accSym = m?.[2] || '';
      const octave = Number(m?.[3] || 4);
      const pitch = pitchFromParts(letter, accSym, octave);

      // Stem up if below middle line; down on/above it
      const stemDir = pitch >= middlePitch ? -1 : 1;

      const staveNote = new VF.StaveNote({
        clef,
        keys: [key],
        duration: 'q',
        stem_direction: stemDir,
      });

      if (accidental) {
        staveNote.addAccidental(0, new VF.Accidental(accidental));
      }
      return staveNote;
    });
  }

  function renderStaffRow(row, containerEl, modelRow) {
    if (!VF) {
      const fallback = document.createElement('div');
      fallback.className = 'staff-fallback';
      fallback.textContent = `${row.writtenKeyName} ${row.scaleLabel}: ${row.notesText}`;
      containerEl.appendChild(fallback);
      return;
    }

    const rowEl = document.createElement('div');
    rowEl.className = 'staff-row';

    if (modelRow && modelRow.id) {
      rowEl.dataset.rowId = modelRow.id;
    }

    const labelEl = document.createElement('div');
    labelEl.className = 'staff-label';
    labelEl.textContent = `${row.writtenKeyName} ${row.scaleLabel}`;
    rowEl.appendChild(labelEl);

    const staffEl = document.createElement('div');
    staffEl.className = 'staff-svg';
    rowEl.appendChild(staffEl);

    containerEl.appendChild(rowEl);

    const measuredWidth = staffEl.clientWidth || containerEl.clientWidth || 800;
    const width = measuredWidth;
    const height = 150;

    const renderer = new VF.Renderer(staffEl, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();

    // Softer staff lines, stems, clefs; keep notes bright
    context.setFillStyle('#f9fafb');   // noteheads, text stay bright
    context.setStrokeStyle('#6b7280'); // ~50% gray for lines & stems

    const staveWidth = width - 40; // left/right padding inside the row
    const staveX = 20;
    const staveY = 40;
    const stave = new VF.Stave(staveX, staveY, staveWidth);

    // Only the 5 staff lines get 50% gray
    stave.setStyle({ strokeStyle: '#18637eff' }); // gray-500

    stave.addClef(row.clef).addKeySignature(row.writtenKeyName);
    stave.setContext(context).draw();

    // After drawing the staff, reset stroke style back to white
    // so stems/flags/clefs/accidentals remain white:
    context.setStrokeStyle('#f9fafb');

    const noteOctaves = buildUpDownOctaveSequence(row.notesText.split(' '), row.clef);
    const notes = createScaleNotes(noteOctaves, row.clef);

    if (modelRow) {
      modelRow.domRowEl = rowEl;
      modelRow.staffEl = staffEl;
      modelRow.expectedNotes = noteOctaves.map((noteName, idx) => {
        const midi = noteNameToMidi(noteName);
        const freq = midiToFreq(midi);
        return {
          index: idx,
          midi,
          freq,
          name: noteName,
          vf: notes[idx],
          feedback: null,
        };
      });
    }

    const voice = new VF.Voice({
      num_beats: notes.length,
      beat_value: 4,
      resolution: VF.RESOLUTION,
    });

    voice.addTickables(notes);

    const layoutWidth = staveWidth - 60; // keep notes comfortably within the stave
    new VF.Formatter().joinVoices([voice]).format([voice], layoutWidth);
    voice.draw(context, stave);
  }

  // Build the full 12-row dataset for current settings
  function buildGridData(selectedTranspositionId, selectedScaleTypeId) {
    const tx = findTranspositionById(selectedTranspositionId);
    const scaleType = findScaleTypeById(selectedScaleTypeId);

    if (!tx || !scaleType) {
      return [];
    }

    const rows = [];

    ROW_KEYS.forEach((concertName) => {
      const concertKey = findMajorKeyByName(concertName);
      if (!concertKey) {
        return;
      }

      // Compute written key: move by N semitones and find the major key
            const writtenPc = wrapPc(concertKey.pc + tx.offset);
      const writtenKey = findMajorKeyByPc(writtenPc) || concertKey;
      const writtenKeyName = writtenKey.name;

      let scaleNoteNames;

      if (scaleType.mode === 'major') {
        scaleNoteNames = writtenKey.scale.slice();
      } else if (scaleType.mode === 'naturalMinor') {
        const minorKey = findMinorKeyByName(writtenKeyName);
        scaleNoteNames = (minorKey ? minorKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'jazzMinor') {
        const jazzKey = findJazzMinorKeyByName(writtenKeyName);
        scaleNoteNames = (jazzKey ? jazzKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'harmonicMinor') {
        const harmKey = findHarmonicMinorKeyByName(writtenKeyName);
        scaleNoteNames = (harmKey ? harmKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'dorian') {
        const dorKey = findDorianKeyByName(writtenKeyName);
        scaleNoteNames = (dorKey ? dorKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'mixolydian') {
        const mixKey = findMixolydianKeyByName(writtenKeyName);
        scaleNoteNames = (mixKey ? mixKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'minorPent') {
        const pKey = findMinorPentKeyByName(writtenKeyName);
        scaleNoteNames = (pKey ? pKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'blues') {
        const bKey = findBluesKeyByName(writtenKeyName);
        scaleNoteNames = (bKey ? bKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'wholeTone') {
        const wtKey = findWholeToneKeyByName(writtenKeyName);
        scaleNoteNames = (wtKey ? wtKey.scale : writtenKey.scale).slice();
      } else if (scaleType.mode === 'halfWholeDim') {
        const hwKey = findHalfWholeDimKeyByName(writtenKeyName);
        scaleNoteNames = (hwKey ? hwKey.scale : writtenKey.scale).slice();
      } else {
        // Fallback: just use major if we ever get an unknown mode
        scaleNoteNames = writtenKey.scale.slice();
      }

      rows.push({
        concertKeyName: concertKey.name,
        writtenKeyName,
        clef: tx.clef,
        scaleLabel: scaleType.label,
        notesText: scaleNoteNames.join(' '),
      });

    });

    return rows;
  }

  // --- Rendering ----------------------------------------------------------

  function populateDropdowns() {
    // Transpositions
    transpositionSelect.innerHTML = '';
    TRANSPOSITIONS.forEach((tx, idx) => {
      const opt = document.createElement('option');
      opt.value = tx.id;
      opt.textContent = tx.label;
      if (idx === 0) {
        opt.selected = true;
      }
      transpositionSelect.appendChild(opt);
    });

    // Scale types
    scaleTypeSelect.innerHTML = '';
    SCALE_TYPES.forEach((st, idx) => {
      const opt = document.createElement('option');
      opt.value = st.id;
      opt.textContent = st.label;
      if (idx === 0) {
        opt.selected = true;
      }
      scaleTypeSelect.appendChild(opt);
    });
  }

  function renderGrid() {
    const txId = transpositionSelect.value;
    const scaleTypeId = scaleTypeSelect.value;

    const tx = findTranspositionById(txId);
    const scaleType = findScaleTypeById(scaleTypeId);

    if (!tx || !scaleType) {
      gridStatus.textContent = 'Select an instrument and scale type to see scales.';
      notationContainer.innerHTML = '';
      return;
    }

    const rows = buildGridData(txId, scaleTypeId);

    const gridModel = {
      transpositionId: txId,
      scaleTypeId: scaleTypeId,
      rows: [],
    };

    gridStatus.textContent =
      `Showing ${scaleType.label} scales for ${tx.label}. `;

    notationContainer.innerHTML = '';

    rows.forEach((row, index) => {
      const rowModel = {
        id: `row_${index}_${row.writtenKeyName}_${scaleTypeId}_${txId}`,
        index,
        concertKeyName: row.concertKeyName,
        writtenKeyName: row.writtenKeyName,
        clef: row.clef,
        scaleLabel: row.scaleLabel,
        notesText: row.notesText,
        expectedNotes: [],
      };

      renderStaffRow(row, notationContainer, rowModel);
      gridModel.rows.push(rowModel);
    });

    window.SCALE_APP = window.SCALE_APP || {};
    window.SCALE_APP.grid = gridModel;
  }

  // --- Tuning Overlay -----------------------------------------------------

  function populateTuningOverlay() {
    if (!tuningOverlaySelect) return;

    tuningOverlaySelect.innerHTML = '<option value="" disabled selected>Choose…</option>';
    TRANSPOSITIONS.forEach((tx) => {
      const opt = document.createElement('option');
      opt.value = tx.id;
      opt.textContent = tx.label;
      tuningOverlaySelect.appendChild(opt);
    });
  }

  function initTuningOverlay() {
    if (!tuningOverlay || !tuningOverlaySelect || !tuningOverlayStart) {
      return;
    }

    populateTuningOverlay();

    // Check for saved tuning
    const savedTuning = localStorage.getItem(TUNING_STORAGE_KEY);
    if (savedTuning && TRANSPOSITIONS.some((t) => t.id === savedTuning)) {
      // User has a saved tuning - hide overlay and apply it
      tuningOverlay.classList.add('hidden');
      transpositionSelect.value = savedTuning;
      renderGrid();
      return;
    }

    // No saved tuning - show overlay
    tuningOverlay.classList.remove('hidden');

    // Enable button when selection is made
    tuningOverlaySelect.addEventListener('change', () => {
      tuningOverlayStart.disabled = !tuningOverlaySelect.value;
    });

    // Handle start button click
    tuningOverlayStart.addEventListener('click', () => {
      const selectedTuning = tuningOverlaySelect.value;
      if (!selectedTuning) return;

      // Save to localStorage
      localStorage.setItem(TUNING_STORAGE_KEY, selectedTuning);

      // Sync with main dropdown and render
      transpositionSelect.value = selectedTuning;
      renderGrid();

      // Hide overlay
      tuningOverlay.classList.add('hidden');
    });
  }

  // --- Wiring -------------------------------------------------------------

  function init() {
    if (!transpositionSelect || !scaleTypeSelect || !notationContainer || !gridStatus) {
      console.error('Scale Machine: missing DOM elements. Check index.html IDs.');
      return;
    }

    populateDropdowns();
    initTuningOverlay();
    renderGrid();

    transpositionSelect.addEventListener('change', () => {
      // Save tuning choice to localStorage when changed via main dropdown
      localStorage.setItem(TUNING_STORAGE_KEY, transpositionSelect.value);
      renderGrid();
    });
    scaleTypeSelect.addEventListener('change', renderGrid);
  }

    // Expose a helper bundle for Smart Listening Mode
  window.SCALE_APP = window.SCALE_APP || {};
  window.SCALE_APP.helpers = {
    findTranspositionById,
    wrapPc,
    parseNoteName,
    pitchFromParts,
    buildUpDownOctaveSequence,
    findMajorKeyByPc,
    noteNameToMidi,
    midiToFreq,
    toVexKey,
    createScaleNotes,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();