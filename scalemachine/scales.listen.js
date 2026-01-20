// scales.listen.js
// Smart Listening Mode: microphone + tonic detection + 16-slot model.

(function () {
  'use strict';

  const cfg = window.SCALE_CONFIG;
  if (!cfg) {
    console.error('SCALE_CONFIG not found for listen mode.');
    return;
  }

  const {
    LISTEN_PATTERN,
    LISTEN_DEFAULT_BPM,
    LISTEN_MIN_RMS,
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
    SCALE_TYPES,
  } = cfg;

  const helpers = (window.SCALE_APP && window.SCALE_APP.helpers) || {};
  const {
    findTranspositionById,
    wrapPc,
    buildUpDownOctaveSequence,
    findMajorKeyByPc,
    noteNameToMidi,
    midiToFreq,
    createScaleNotes,
  } = helpers;

  if (
    !findTranspositionById ||
    !wrapPc ||
    !buildUpDownOctaveSequence ||
    !findMajorKeyByPc ||
    !noteNameToMidi ||
    !midiToFreq ||
    !createScaleNotes
  ) {
    console.warn('SCALE_APP helpers not found; Smart Listening Mode will be disabled.');
    return;
  }

  const VF = (window.Vex && window.Vex.Flow) || null;

  // Returns 'instrument' or 'voice'. You can set this from the console:
  //   SCALE_APP.listenProfile = 'voice';
  // If unset, defaults to 'instrument'.
  function getListenProfile() {
    try {
      if (
        window.SCALE_APP &&
        typeof window.SCALE_APP.listenProfile === 'string'
      ) {
        return window.SCALE_APP.listenProfile;
      }
    } catch (e) {
      // ignore
    }
    return 'instrument';
  }  
  const state = {
    audioContext: null,
    analyser: null,
    micSource: null,
    rafId: null,
    mode: 'idle', // 'idle' | 'listening_for_tonic' | 'captured_tonic' | 'following_scale'
    tonic: null,
    bpm: LISTEN_DEFAULT_BPM || 72,
    slots: [],
    statusEl: null,
    buttonEl: null,
    buttonLabelEl: null,
    lastStableFreq: null,
    stableFrames: 0,
    tonicFreqBuffer: [],
    // Rolling buffer for follow-mode smoothing.
    followFreqBuffer: [],
    panelEl: null,
    activeBoxEl: null,
    activeStageEl: null,
  };

  // Only accept pitches in a realistic musical range
  const MIN_FREQ_HZ = 60;   // below this is likely hum / noise
  const MAX_FREQ_HZ = 2000; // above this is likely an artefact

    // Debug switch: when true, any detected onset advances regardless of pitch.
  // You can also toggle window.SCALE_APP.DEBUG_ACCEPT_ANY_NOTE = true in the console.
  const DEBUG_ACCEPT_ANY_NOTE = false;

  function isDebugAcceptAnyNote() {
    try {
      if (
        typeof window !== 'undefined' &&
        window.SCALE_APP &&
        window.SCALE_APP.DEBUG_ACCEPT_ANY_NOTE === true
      ) {
        return true;
      }
    } catch (e) {
      // ignore
    }
    return DEBUG_ACCEPT_ANY_NOTE === true;
  }

  // Map listenState.transpositionId to a semitone offset so that
  // expectedNotes.midi represents *concert* pitch (what the mic hears),
  // while note names / key signature stay in written space.
  function getTranspositionOffset(ls) {
    if (!ls || !ls.transpositionId) return 0;
    const id = String(ls.transpositionId).toLowerCase();

    // Bb instruments (trumpet, clarinet, tenor sax, etc.)
    if (id.includes('bb')) return -2;

    // Eb instruments (alto / bari sax, etc.)
    if (id.includes('eb')) return 3;

    // F instruments (horn in F, etc.)
    if (id === 'f' || id.includes('horn')) return -5;

    // Voice / piano / concert / unknown → treat as concert
    return 0;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function updateStatus(text) {
    if (state.statusEl) {
      state.statusEl.textContent = text;
    }
  }

  // Update the visual tuner gauge
  // text: note label like "A4 · 440.0 Hz"
  // cents: offset from target (-50 to +50 typical range, clamped to ±60)
  function updateTuner(text, cents) {
    var label = document.getElementById('tunerLabel');
    var needle = document.getElementById('tunerNeedle');

    if (label) {
      label.textContent = text || '';
    }

    if (needle) {
      if (text && cents !== undefined && cents !== null) {
        // Clamp cents to ±60 for display, map to 0-100% position
        // -60 cents = 0%, 0 cents = 50%, +60 cents = 100%
        var clampedCents = Math.max(-60, Math.min(60, cents));
        var percent = 50 + (clampedCents / 60) * 50;
        needle.style.left = percent + '%';
        needle.classList.remove('tuner-needle-hidden');
      } else {
        // No pitch — hide needle at center
        needle.style.left = '50%';
        needle.classList.add('tuner-needle-hidden');
      }
    }
  }

  function stopRafLoop() {
    if (state.rafId != null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  // Stream is kept alive for the entire page session — user only selects mic once.
  // Stream is automatically released when the page unloads.
  function stopListening() {
    stopRafLoop();
    state.mode = 'idle';
    if (state.panelEl) {
      state.panelEl.classList.remove('is-open');
    }
    state.lastStableFreq = null;
    state.stableFrames = 0;
    state.tonicFreqBuffer = [];
    state.lastNoteMidi = null;

    // NOTE: We intentionally do NOT disconnect micSource or analyser here.
    // The stream persists so the user doesn't have to re-select their mic
    // every time they stop/start listening within a practice session.

    // Hide the magic box again
    var box = document.getElementById('activeScaleBox');
    if (box) {
      box.style.display = 'none';
    }

    var activeStatus = document.getElementById('activeScaleStatus');
    if (activeStatus) {
      activeStatus.textContent = '';
    }

    updateStatus('');
    if (state.buttonEl) {
      state.buttonEl.disabled = false;
    }
    if (state.buttonLabelEl) {
      state.buttonLabelEl.textContent = 'Listen';
    }
  }

  function ensureAudioContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.error('Web Audio API not supported in this browser.');
      updateStatus('Audio not supported in this browser.');
      return null;
    }

    if (!state.audioContext) {
      state.audioContext = new AC();
    }

    if (state.audioContext.state === 'suspended') {
      state.audioContext.resume().catch(function (err) {
        console.warn('Could not resume AudioContext:', err);
      });
    }

    return state.audioContext;
  }

  function startListeningForTonic() {
    const ac = ensureAudioContext();
    if (!ac) return;

    state.mode = 'listening_for_tonic';
    if (state.panelEl) {
      state.panelEl.classList.add('is-open');
    }
    state.lastStableFreq = null;
    state.stableFrames = 0;
    state.tonicFreqBuffer = [];
    state.slots = [];
    state.tonic = null;

    if (state.buttonEl) {
      state.buttonEl.disabled = false;
    }
    if (state.buttonLabelEl) {
      state.buttonLabelEl.textContent = 'Listening';
    }
    updateStatus('');

    // Show the magic box under the Listen strip
    var box = document.getElementById('activeScaleBox');
    if (box) {
      box.style.display = 'block';
    }

    // Render a clef-only staff immediately so the box feels "armed"
    try {
      var txSelect = $('transpositionSelect');
      if (txSelect) {
        var txId = txSelect.value;
        var tx = findTranspositionById(txId);
        var clef = (tx && tx.clef) || 'treble';
        renderEmptyActiveStaff(clef);
      } else {
        renderEmptyActiveStaff('treble');
      }
    } catch (e) {
      console.warn('[Listen] Could not render empty active staff:', e);
    }

    // Reuse existing mic stream if available (e.g., after Reset)
    if (state.micSource && state.analyser) {
      console.log('[Listen] Reusing existing mic stream for tonic detection');
      const buffer = new Float32Array(state.analyser.fftSize);
      startTonicLoop(ac, buffer);
      return;
    }

    // No existing stream — request mic permission
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      updateStatus('Microphone not available in this browser.');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        const source = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;

        source.connect(analyser);

        state.micSource = source;
        state.analyser = analyser;

        const buffer = new Float32Array(analyser.fftSize);
        startTonicLoop(ac, buffer);
      })
      .catch(function (err) {
        console.error('Error accessing microphone', err);
        updateStatus('Could not access microphone. Check permissions and try again.');
        if (state.buttonEl) {
          state.buttonEl.disabled = false;
          state.buttonEl.textContent = 'Listen';
        }
        state.mode = 'idle';
      });
  }

  // Extracted tonic detection loop so it can be called from both fresh and reuse paths
  function startTonicLoop(ac, buffer) {
    function frame() {
      if (state.mode !== 'listening_for_tonic' || !state.analyser) {
        return;
      }

      state.analyser.getFloatTimeDomainData(buffer);

      const rms = computeRms(buffer);
      const rmsFloor = LISTEN_MIN_RMS || 0.001;

      if (rms < rmsFloor) {
        updateStatus('Listening… (play a clear note)');
        updateTuner('');
        state.stableFrames = 0;
        if (Array.isArray(state.tonicFreqBuffer)) {
          state.tonicFreqBuffer.length = 0;
        }
        state.rafId = requestAnimationFrame(frame);
        return;
      }

      const freq = detectPitch(buffer, ac.sampleRate);

      if (freq && freq >= MIN_FREQ_HZ && freq <= MAX_FREQ_HZ) {
        if (!Array.isArray(state.tonicFreqBuffer)) {
          state.tonicFreqBuffer = [];
        }
        const buf = state.tonicFreqBuffer;
        buf.push(freq);
        if (buf.length > 5) buf.shift();

        if (buf.length >= 3) {
          const sorted = buf.slice().sort(function (a, b) { return a - b; });
          const medianFreq = sorted[Math.floor(sorted.length / 2)];
          const midi = freqToMidi(medianFreq);
          const noteLabel = midiToNoteName(midi);

          updateTuner(noteLabel + ' · ' + medianFreq.toFixed(1) + ' Hz');

          const centsDrift = 1200 * Math.log2(freq / medianFreq);
          const absDrift = Math.abs(centsDrift);
          const STABILITY_CENTS = 15;
          const MIN_STABLE_FRAMES = 2;

          if (absDrift <= STABILITY_CENTS) {
            state.stableFrames += 1;
          } else {
            state.stableFrames = 0;
          }

          updateStatus('Play tonic and hold…');

          if (state.stableFrames >= MIN_STABLE_FRAMES) {
            // Calculate how sharp/flat the note is
            const exactMidi = 69 + 12 * Math.log2(medianFreq / 440);
            const roundedMidi = Math.round(exactMidi);
            const centsOff = (exactMidi - roundedMidi) * 100;

            let tuningDesc = '';
            if (Math.abs(centsOff) <= 10) {
              tuningDesc = '';
            } else if (centsOff > 30) {
              tuningDesc = ' (very sharp)';
            } else if (centsOff > 10) {
              tuningDesc = ' (sharp)';
            } else if (centsOff < -30) {
              tuningDesc = ' (very flat)';
            } else if (centsOff < -10) {
              tuningDesc = ' (flat)';
            }

            console.log(
              '[Listen] tonic locked at median',
              medianFreq.toFixed(1),
              'Hz after',
              state.stableFrames,
              'stable frames,',
              centsOff.toFixed(0),
              'cents off'
            );
            state.stableFrames = 0;
            state.tonicFreqBuffer = [];
            lockTonic(medianFreq, tuningDesc);
            return;
          }
        } else {
          updateTuner('…');
          updateStatus('Play tonic and hold…');
          state.stableFrames = 0;
        }

        state.rafId = requestAnimationFrame(frame);
        return;
      }

      updateStatus('Listening… (hold a steady note)');
      updateTuner('');
      state.stableFrames = 0;
      state.rafId = requestAnimationFrame(frame);
    }

    state.rafId = requestAnimationFrame(frame);
  }

  function computeRms(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const v = buffer[i];
      sum += v * v;
    }
    return Math.sqrt(sum / buffer.length);
  }

  // Basic autocorrelation pitch detection for a monophonic signal.
  function detectPitch(buffer, sampleRate) {
    const size = buffer.length;
    const maxSamples = Math.floor(size / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let foundGoodCorrelation = false;
    let lastCorrelation = 1;

    for (let offset = 1; offset < maxSamples; offset += 1) {
      let correlation = 0;
      for (let i = 0; i < maxSamples; i += 1) {
        correlation += buffer[i] * buffer[i + offset];
      }
      correlation /= maxSamples;

      if (correlation > 0.9 && correlation > lastCorrelation) {
        foundGoodCorrelation = true;
      } else if (foundGoodCorrelation) {
        const shift =
          (correlation - lastCorrelation) /
          (2 * lastCorrelation - 2 * correlation);
        const freq = sampleRate / (offset + shift);
        if (freq >= MIN_FREQ_HZ && freq <= MAX_FREQ_HZ) {
          return freq;
        }
        return null;
      }

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
      lastCorrelation = correlation;
    }

    if (bestCorrelation > 0.01 && bestOffset > 0) {
      const freq = sampleRate / bestOffset;
      if (freq >= MIN_FREQ_HZ && freq <= MAX_FREQ_HZ) {
        return freq;
      }
    }
    return null;
  }
  function freqToMidi(freq) {
    return Math.round(69 + 12 * Math.log2(freq / 440));
  }

  function midiToPc(midi) {
    return ((midi % 12) + 12) % 12;
  }

  const PITCH_CLASS_NAMES = [
    'C',
    'C♯',
    'D',
    'E♭',
    'E',
    'F',
    'F♯',
    'G',
    'A♭',
    'A',
    'B♭',
    'B',
  ];

  function midiToNoteName(midi) {
    const pc = midiToPc(midi);
    const name = PITCH_CLASS_NAMES[pc] || '?';
    const octave = Math.floor(midi / 12) - 1;
    return name + octave;
  }

  // Map cents error to an emoji:

  // Four-zone cents tolerance:
  // 1) |err| <= STRICT_ZONE_CENTS  → 🟩 (in tune / advance allowed)
  // 2) STRICT_ZONE_CENTS–LOOSE_ZONE_CENTS sharp  → 🟦
  // 3) STRICT_ZONE_CENTS–LOOSE_ZONE_CENTS flat   → 🟨
  // 4) > LOOSE_ZONE_CENTS                         → 🟥
  const STRICT_ZONE_CENTS = 25; // "Green" zone: musically in tune
  const LOOSE_ZONE_CENTS = 60;  // Up to ~half-step edge

  // Tonic checkpoint tolerance: more generous than normal strict zone
  // but still requires you to be "in the ballpark" of the tonic
  const TONIC_TOLERANCE_CENTS = 50;

  function classifyErrorToEmoji(errCents) {
    const abs = Math.abs(errCents);
    if (abs <= STRICT_ZONE_CENTS) {
      return '🟩';
    }
    if (abs <= LOOSE_ZONE_CENTS) {
      return errCents > 0 ? '🟦' : '🟨';
    }
    return '🟥';
  }

  // Expose for console testing (IIFE keeps everything private otherwise)
  window.classifyErrorToEmoji = classifyErrorToEmoji;

  // Render an empty staff (hardware only) in the Magic Box when we first start listening.
  function renderEmptyActiveStaff(clef) {
    if (!VF) {
      console.warn('[Listen] VexFlow not available for empty active staff.');
      return;
    }

    const stage =
      state.activeStageEl || document.getElementById('activeScaleStage');
    if (!stage) {
      console.warn('[Listen] activeScaleStage element not found for empty staff.');
      return;
    }

    // Ensure there is a listenState to hang metadata on, but don't require it yet.
    if (!window.SCALE_APP) window.SCALE_APP = {};
    if (!window.SCALE_APP.listenState) {
      window.SCALE_APP.listenState = {
        expectedNotes: [],
        currentIndex: 0,
      };
    }
    const ls = window.SCALE_APP.listenState;

    ls.noteSequence = [];
    ls.clef = clef || ls.clef || 'treble';
    if (!ls.writtenKeyName) {
      ls.writtenKeyName = 'C';
    }

    // Clear any previous SVG content
    stage.innerHTML = '';

    const measuredWidth =
      stage.clientWidth ||
      (stage.parentElement && stage.parentElement.clientWidth) ||
      800;
    const width = measuredWidth;
    const height = 150;

    const renderer = new VF.Renderer(stage, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();

    // Match grid style: soft staff lines
    context.setFillStyle('#f9fafb');
    context.setStrokeStyle('#6b7280');

    const staveWidth = width - 40;
    const staveX = 20;
    const staveY = 40;
    const stave = new VF.Stave(staveX, staveY, staveWidth);

    // Just clef — no key signature or notes yet
    stave.setStyle({ strokeStyle: '#18637eff' });
    stave.addClef(ls.clef);
    stave.setContext(context).draw();

    // Keep references for future use if needed
    stage._vfRenderer = renderer;
    stage._vfContext = context;
    stage._vfStave = stave;
    stage._vfNotes = [];
  }

  // Build interval-aware pitch territories for each expected note.
  // Prefer the explicit tolDownCents/tolUpCents if present (set in renderActiveScaleStaff),
  // otherwise fall back to symmetric half-gap territories.
  function buildTerritoriesFromExpected(expectedNotes) {
    if (!Array.isArray(expectedNotes) || expectedNotes.length === 0) return;

    function intervalCents(a, b) {
      if (
        !a ||
        !b ||
        typeof a.midi !== 'number' ||
        typeof b.midi !== 'number'
      ) {
        return null;
      }
      var diffSemis = Math.abs(a.midi - b.midi);
      if (!diffSemis) return null;
      return diffSemis * 100; // 1 semitone ≈ 100 cents
    }

    for (var i = 0; i < expectedNotes.length; i++) {
      var curr = expectedNotes[i];
      if (!curr) continue;

      // 🔑 If renderActiveScaleStaff already defined tolDownCents/tolUpCents,
      // treat those as the authoritative territory.
      if (
        typeof curr.tolDownCents === 'number' &&
        typeof curr.tolUpCents === 'number'
      ) {
        curr.territory = {
          leftCents: curr.tolDownCents,
          rightCents: curr.tolUpCents,
        };
        continue;
      }

      // Fallback: derive from neighbor spacing.
      var prev = i > 0 ? expectedNotes[i - 1] : null;
      var next = i < expectedNotes.length - 1 ? expectedNotes[i + 1] : null;

      // Distance to neighbors (in cents).
      // For edges, mirror the one neighbor so the outside remains playable.
      var leftInterval = prev
        ? intervalCents(prev, curr)
        : (next ? intervalCents(curr, next) : 200);

      var rightInterval = next
        ? intervalCents(curr, next)
        : (prev ? intervalCents(prev, curr) : 200);

      if (!leftInterval) leftInterval = rightInterval || 200;
      if (!rightInterval) rightInterval = leftInterval || 200;

      // Each note "owns" half of the space toward each neighbor.
      var leftExtent = -0.5 * leftInterval;   // negative cents (flat side)
      var rightExtent = 0.5 * rightInterval;  // positive cents (sharp side)

      curr.territory = {
        leftCents: leftExtent,
        rightCents: rightExtent,
      };
    }
  }  // Render the active scale staff inside the Magic Box.
  function renderActiveScaleStaff(noteSequence, clef) {
    if (!VF) {
      console.warn('[Listen] VexFlow not available for active scale staff.');
      return;
    }

    const stage =
      state.activeStageEl || document.getElementById('activeScaleStage');
    if (!stage) {
      console.warn('[Listen] activeScaleStage element not found.');
      return;
    }

    const ls = (window.SCALE_APP && window.SCALE_APP.listenState) || null;
    if (!ls) {
      console.warn('[Listen] No listenState available for active scale staff.');
      return;
    }

    const seq =
      Array.isArray(noteSequence) && noteSequence.length
        ? noteSequence
        : (ls.noteSequence && ls.noteSequence.length
            ? ls.noteSequence
            : null);

    if (!seq || !seq.length) {
      console.warn('[Listen] No note sequence for active scale staff.');
      return;
    }

    // Persist sequence + clef on listenState so we can re-render on resize
    ls.noteSequence = seq.slice();
    if (clef) {
      ls.clef = clef;
    } else if (!ls.clef) {
      ls.clef = 'treble';
    }

    // Clear previous SVG
    stage.innerHTML = '';

    const measuredWidth =
      stage.clientWidth ||
      (stage.parentElement && stage.parentElement.clientWidth) ||
      800;
    const width = measuredWidth;
    const height = 150;

    const renderer = new VF.Renderer(stage, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();

    // Match grid style: soft staff lines, bright notes
    context.setFillStyle('#f9fafb');
    context.setStrokeStyle('#6b7280');

    const staveWidth = width - 40;
    const staveX = 20;
    const staveY = 40;
    const stave = new VF.Stave(staveX, staveY, staveWidth);

    const writtenKeyName =
      ls.writtenKeyName ||
      (ls.tonic && ls.tonic.writtenKeyName) ||
      'C';

    stave.setStyle({ strokeStyle: '#18637eff' });
    stave.addClef(ls.clef).addKeySignature(writtenKeyName);
    stave.setContext(context).draw();

    // After drawing staff lines, switch stems/flags/etc. back to bright
    context.setStrokeStyle('#f9fafb');

    const notes = createScaleNotes(seq, ls.clef);

    // Align each degree to the closest octave relative to the tonic (written),
    // then shift to CONCERT pitch using the transposition offset so that
    // expectedNotes.midi matches what the mic actually hears.
    const tonicMidi =
      ls.tonic && typeof ls.tonic.midi === 'number'
        ? ls.tonic.midi
        : 60; // fallback C4 if something is weird

    const transposeOffset =
      (typeof getTranspositionOffset === 'function')
        ? getTranspositionOffset(ls)
        : 0;

    // Written MIDI (from note names as rendered on the staff).
    const writtenMidiSeq = seq.map(function (noteName) {
      return noteNameToMidi(noteName);
    });

    // Pull each written note into the register closest to the tonic,
    // then apply the transposition offset to get concert MIDI.
    const midiSeq = writtenMidiSeq.map(function (base) {
      if (typeof base !== 'number' || !Number.isFinite(base)) return base;

      let best = base;
      let bestDiff = Math.abs(base - tonicMidi);

      // Search a few octaves up/down for the closest register to the tonic.
      for (let k = -3; k <= 3; k += 1) {
        const cand = base + 12 * k;
        const diff = Math.abs(cand - tonicMidi);
        if (diff < bestDiff) {
          best = cand;
          bestDiff = diff;
        }
      }

      // Shift into concert pitch (what the mic hears).
      return best + transposeOffset;
    });

    // Rebuild expectedNotes to point at these active staff notes,
    // preserving any existing feedback flags (🟩/🟦/🟨/🟥) and
    // adding per-degree territory windows in cents.
    //
    // Also mark tonic notes (checkpoints) by comparing to writtenKeyName.
    const tonicName = (ls.writtenKeyName || 'C').replace(/[0-9]/g, '');

    const updatedExpected = seq.map(function (noteName, idx) {
      const midi = midiSeq[idx];
      const freq = midiToFreq(midi);
      const prev =
        (ls.expectedNotes && ls.expectedNotes[idx]) || {};

      const prevMidi = idx > 0 ? midiSeq[idx - 1] : null;
      const nextMidi = idx < midiSeq.length - 1 ? midiSeq[idx + 1] : null;

      // Diatonic neighbor spacing in semitones.
      const downSemi = prevMidi != null ? midi - prevMidi : 0;
      const upSemi = nextMidi != null ? nextMidi - midi : 0;

      // Each degree owns ~80% of the gap to its neighbors.
      // This leaves a small "no man's land" between degrees,
      // but makes it much harder to accidentally fall into the red zone.
      const TERRITORY_FRACTION = 0.80;

      const tolDownCents =
        downSemi > 0 ? -100 * downSemi * TERRITORY_FRACTION : -600;
      const tolUpCents =
        upSemi > 0 ? 100 * upSemi * TERRITORY_FRACTION : 600;

      // Check if this note is a tonic (checkpoint)
      const noteBase = noteName.replace(/[0-9]/g, '');
      const isTonic = noteBase === tonicName;

      return {
        index: idx,
        midi: midi,
        freq: freq,
        name: noteName,
        vf: notes[idx],
        feedback: prev.feedback || null,
        tolDownCents: tolDownCents,
        tolUpCents: tolUpCents,
        isTonic: isTonic,
      };
    });

    // Attach emoji annotations above notes before layout/draw.
    updatedExpected.forEach(function (en, idx) {
      if (!en || !en.feedback || !notes[idx]) return;

      const ann = new VF.Annotation(en.feedback)
        .setFont('Arial', 20, 'normal')
        .setVerticalJustification(VF.Annotation.VerticalJustify.TOP);

      // More breathing room above the staff
      ann.setYShift(-18);

      notes[idx].addAnnotation(0, ann);
    });

    ls.expectedNotes = updatedExpected;

    // Build interval-aware pitch territories for each degree so follow mode
    // knows how far each note "owns" before it becomes its neighbor.
    buildTerritoriesFromExpected(ls.expectedNotes);

    const voice = new VF.Voice({
      num_beats: notes.length,
      beat_value: 4,
      resolution: VF.RESOLUTION,
    });

    voice.addTickables(notes);

    const layoutWidth = staveWidth - 60;
    new VF.Formatter().joinVoices([voice]).format([voice], layoutWidth);
    voice.draw(context, stave);

    // Keep a simple reference for future tweaks.
    stage._vfRenderer = renderer;
    stage._vfContext = context;
    stage._vfStave = stave;
    stage._vfNotes = notes;  
  }

  // Core evaluation (simplified, degree-based):
  // We assume a current degree index and simply check:
  //   "Does this pitch belong to THIS degree, and how far off is it?"
  // Emoji meaning:
  //   🟩 = in tune on this degree (advances)
  //   🟦 = sharp but this degree (still advances)
  //   🟨 = flat but this degree (still advances)
  //   🟥 = not this degree (does NOT advance)
// ScaleStepper: state machine that advances through the scale
// based on discrete note-on events + pitch classification.
function handleNoteEvent(pitchFrame) {
  const app = window.SCALE_APP || {};
  const ls = app.listenState;
  if (!ls) {
    console.warn('[Listen] handleNoteEvent called without listenState.');
    return;
  }

  const notes = ls.expectedNotes || [];
  if (!notes.length) {
    console.warn('[Listen] No expectedNotes in listenState for handleNoteEvent.');
    return;
  }

  // Initialize stepper state
  if (typeof ls.currentIndex !== 'number') {
    ls.currentIndex = 0;
  }
  if (!ls.progressState) {
    ls.progressState = 'idle'; // 'idle' | 'running' | 'done'
  }

  const idx = ls.currentIndex;
  const expected = notes[idx];
  if (!expected) {
    console.warn('[Listen] No expected note at currentIndex', idx);
    return;
  }

  // Debug knob: accept any onset as "good" and advance
  const DEBUG_ACCEPT_ANY_NOTE = false;

  // Normalize the incoming pitch summary.
  // We prefer { degreeIndex, centsOffset, freqHz } as emitted from follow-mode,
  // but also tolerate raw frequency for _debugNote() calls.
  let frame = {
    degreeIndex: null,
    centsOffset: 0,
    freqHz: null,
  };

  if (pitchFrame && typeof pitchFrame === 'object') {
    frame.degreeIndex =
      typeof pitchFrame.degreeIndex === 'number'
        ? pitchFrame.degreeIndex
        : (ls.tuner && typeof ls.tuner.degreeIndex === 'number'
            ? ls.tuner.degreeIndex
            : null);

    frame.centsOffset =
      typeof pitchFrame.centsOffset === 'number'
        ? pitchFrame.centsOffset
        : (ls.tuner && typeof ls.tuner.centsOffset === 'number'
            ? ls.tuner.centsOffset
            : 0);

    frame.freqHz =
      typeof pitchFrame.freqHz === 'number'
        ? pitchFrame.freqHz
        : (ls.tuner && typeof ls.tuner.freqHz === 'number'
            ? ls.tuner.freqHz
            : null);
  } else if (typeof pitchFrame === 'number') {
    // Fallback: raw frequency (used by SCALE_APP._debugNote).
    frame.freqHz = pitchFrame;

    // Approximate best degree using MIDI distance.
    if (typeof freqToMidi === 'function') {
      const detectedMidi = freqToMidi(pitchFrame);
      let bestIdx = null;
      let bestDiff = Infinity;

      for (let j = 0; j < notes.length; j += 1) {
        const n = notes[j];
        if (!n || typeof n.midi !== 'number') continue;
        const diff = Math.abs(detectedMidi - n.midi);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = j;
        }
      }

      frame.degreeIndex = bestIdx;
      if (
        bestIdx !== null &&
        bestIdx >= 0 &&
        bestIdx < notes.length &&
        typeof midiToFreq === 'function'
      ) {
        const baseMidi = notes[bestIdx].midi;
        const expectedFreq = midiToFreq(baseMidi);
        if (expectedFreq > 0) {
          frame.centsOffset = 1200 * Math.log2(pitchFrame / expectedFreq);
        } else {
          frame.centsOffset = 0;
        }
      } else {
        frame.centsOffset = 0;
      }
    }
  } else {
    // Last-ditch fallback: use tuner snapshot if present.
    frame.degreeIndex =
      ls.tuner && typeof ls.tuner.degreeIndex === 'number'
        ? ls.tuner.degreeIndex
        : null;
    frame.centsOffset =
      ls.tuner && typeof ls.tuner.centsOffset === 'number'
        ? ls.tuner.centsOffset
        : 0;
    frame.freqHz =
      ls.tuner && typeof ls.tuner.freqHz === 'number'
        ? ls.tuner.freqHz
        : null;
  }

  const playedIdx = frame.degreeIndex;

  // Debug mode: any onset advances one step with a green emoji.
  if (DEBUG_ACCEPT_ANY_NOTE) {
    expected.feedback = '🟩';
    expected.detectedFreqHz = frame.freqHz;
    expected.pitchErrorCents = 0;

    notes.forEach(function (n, j) {
      if (j !== idx && n) {
        n.feedback = null;
      }
    });

    if (ls.currentIndex < notes.length - 1) {
      ls.currentIndex += 1;
      ls.progressState = 'running';
    } else {
      ls.currentIndex = 0;
      ls.progressState = 'done';
      notes.forEach(function (n) {
        if (n) n.feedback = null;
      });
      try {
        renderEmptyActiveStaff(ls.clef || 'treble');
      } catch (e) {
        console.warn('[Listen] Could not render empty active staff after completion:', e);
      }
      return;
    }

    try {
      if (ls.noteSequence && ls.noteSequence.length) {
        renderActiveScaleStaff(ls.noteSequence, ls.clef || 'treble');
      }
    } catch (e) {
      console.error('[Listen] Error re-rendering active scale staff (DEBUG_ACCEPT_ANY)', e);
    }

    console.log(
      '[Listen][DEBUG_ANY] idx =',
      idx,
      ', freq =',
      frame.freqHz && typeof frame.freqHz === 'number'
        ? frame.freqHz.toFixed(1) + 'Hz'
        : '(n/a)',
      ', emoji = 🟩, advance = true'
    );
    return;
  }

  // If we couldn't map this onset to any degree at all, treat as hard wrong.
  if (
    playedIdx === null ||
    playedIdx < 0 ||
    playedIdx >= notes.length
  ) {
    expected.feedback = '🟥';
    expected.detectedFreqHz = frame.freqHz;
    expected.pitchErrorCents = 0;

    notes.forEach(function (n, j) {
      if (j !== idx && n) {
        n.feedback = null;
      }
    });

    try {
      if (ls.noteSequence && ls.noteSequence.length) {
        renderActiveScaleStaff(ls.noteSequence, ls.clef || 'treble');
      }
    } catch (e) {
      console.error(
        '[Listen] Error re-rendering active scale staff after unmapped degree',
        e
      );
    }

    console.log(
      '[Listen] Unmapped degree; marking idx =',
      idx,
      'as 🟥 (no advancement)'
    );
    return;
  }

  // Calculate error relative to the EXPECTED note (not the closest matched degree)
  // This is what matters for feedback: how close were you to what you SHOULD play?
  let errCentsFromExpected = 0;
  if (frame.freqHz && expected.freq && expected.freq > 0) {
    errCentsFromExpected = 1200 * Math.log2(frame.freqHz / expected.freq);
  } else if (frame.freqHz && typeof expected.midi === 'number') {
    const expectedFreq = midiToFreq(expected.midi);
    if (expectedFreq > 0) {
      errCentsFromExpected = 1200 * Math.log2(frame.freqHz / expectedFreq);
    }
  }

  // Territory-based classification relative to the EXPECTED degree.
  let baseEmoji = '🟥';
  let inTerritory = false;

  const territory = expected.territory ? expected.territory : null;
  if (
    territory &&
    typeof territory.leftCents === 'number' &&
    typeof territory.rightCents === 'number'
  ) {
    const left = territory.leftCents;
    const right = territory.rightCents;
    const isSharp = errCentsFromExpected > 0;

    if (errCentsFromExpected < left || errCentsFromExpected > right) {
      // Outside this degree's territory → wrong note.
      baseEmoji = '🟥';
      inTerritory = false;
    } else {
      // Inside this degree's territory → non-red (green/blue/yellow).
      inTerritory = true;

      const span = Math.max(Math.abs(left), Math.abs(right)) || 1;
      const norm = Math.abs(errCentsFromExpected) / span;
      const GREEN_FRACTION = 0.7;

      if (norm <= GREEN_FRACTION) {
        baseEmoji = '🟩';
      } else {
        baseEmoji = isSharp ? '🟦' : '🟨';
      }
    }
  } else {
    // Fallback if we ever lose territory data.
    baseEmoji = classifyErrorToEmoji(errCentsFromExpected);
    inTerritory = baseEmoji !== '🟥';
  }

  // Degree match: we mostly expect playedIdx === idx, but in practice
  // the tuner can land off-by-one. We'll allow ±1 degree slack, but
  // still only ever step *forward* through LISTEN_PATTERN.
  const degreeOffset =
    typeof playedIdx === 'number' ? (playedIdx - idx) : 0;

  const degreeMatches =
    degreeOffset === 0 ||
    Math.abs(degreeOffset) === 1;

  // TONIC CHECKPOINT LOGIC:
  // - Tonic notes (start, turnaround, end) require pitch accuracy
  // - Non-tonic notes advance on any onset (gate-based progression)
  const isTonic = expected.isTonic === true;
  let isGoodForStep;

  if (isTonic) {
    // Tonic checkpoint: must be within TONIC_TOLERANCE_CENTS of the expected pitch
    const tonicOk = Math.abs(errCentsFromExpected) <= TONIC_TOLERANCE_CENTS;
    isGoodForStep = tonicOk;
  } else {
    // Non-tonic: any detected onset advances (gate-based)
    // We still show the feedback emoji, but don't block progression
    isGoodForStep = true;
  }

  // Final emoji we show on the *current* degree:
  // For tonic checkpoints: show 🟥 if pitch was too far off (blocked)
  // For non-tonic: always show the actual accuracy feedback (but still advance)
  const finalEmoji = isTonic
    ? (isGoodForStep ? baseEmoji : '🟥')
    : baseEmoji;

  // Keep the tuner strip in sync with accepted note events as well.
  if (frame.freqHz && typeof freqToMidi === 'function' && typeof midiToNoteName === 'function') {
    const midiForTuner = freqToMidi(frame.freqHz);
    const noteLabelForTuner = midiToNoteName(midiForTuner);
    updateTuner(
      noteLabelForTuner + ' · ' + frame.freqHz.toFixed(1) + ' Hz',
      errCentsFromExpected
    );
  }

  expected.feedback = finalEmoji;
  expected.detectedFreqHz = frame.freqHz;
  expected.pitchErrorCents = errCentsFromExpected;

  // Clear feedback on all other degrees.
  notes.forEach(function (n, j) {
    if (j !== idx && n) {
      n.feedback = null;
    }
  });

  // State machine advancement
  if (isGoodForStep) {
    ls.progressState = 'running';

    if (ls.currentIndex < notes.length - 1) {
      ls.currentIndex += 1;
    } else {
      // Finished the pattern — advance to next chromatic scale
      console.log('[Listen] Completed scale, advancing to next...');
      advanceToNextScale();
      return;
    }
  }

  // Re-render current staff with updated emoji lane.
  try {
    if (ls.noteSequence && ls.noteSequence.length) {
      renderActiveScaleStaff(ls.noteSequence, ls.clef || 'treble');
    }
  } catch (e) {
    console.error(
      '[Listen] Error re-rendering active scale staff with feedback',
      e
    );
  }

  console.log(
    '[Listen] idx =',
    idx,
    'playedIdx =',
    playedIdx,
    ', freq =',
    frame.freqHz && typeof frame.freqHz === 'number'
      ? frame.freqHz.toFixed(1) + 'Hz'
      : '(n/a)',
    'err =',
    errCentsFromExpected.toFixed(1),
    'cents, baseEmoji =',
    baseEmoji,
    ', finalEmoji =',
    finalEmoji,
    ', isTonic =',
    isTonic,
    ', advance =',
    isGoodForStep
  );
}

  // ⭐ Expose helpers to the outside world for UI hooks / debugging.
  if (typeof window !== 'undefined') {
    window.SCALE_APP = window.SCALE_APP || {};

    // Expose handleNoteEvent
    window.SCALE_APP.handleNoteEvent = handleNoteEvent;

    // Simple reset: stop and immediately start listening for a new tonic.
    window.SCALE_APP.resetListen = function () {
      try {
        stopListening();
      } catch (e) {
        console.warn('[Listen] resetListen stopListening error', e);
      }
      try {
        startListeningForTonic();
      } catch (e) {
        console.warn('[Listen] resetListen startListeningForTonic error', e);
      }
    };
  }

    // Debug: manually test a note frequency from the console
  if (typeof window !== 'undefined') {
    window.SCALE_APP._debugNote = function (freq) {
      if (!freq || typeof freq !== 'number') {
        console.warn('Usage: SCALE_APP._debugNote(440)');
        return;
      }
      console.log('[DEBUG] Injecting freq:', freq.toFixed(2), 'Hz');
      try {
        handleNoteEvent(freq);
      } catch (err) {
        console.error('[DEBUG] handleNoteEvent error:', err);
      }
    };
  }

  function findScaleTypeById(id) {
    return SCALE_TYPES.find(function (s) {
      return s.id === id;
    }) || null;
  }

  function findScaleNotesForType(writtenKeyName, scaleType) {
    const mode = scaleType.mode;

    function fromTable(table, fallbackTable) {
      const k = table.find(function (x) {
        return x.name === writtenKeyName;
      });
      const src = k || fallbackTable[0];
      return src.scale.slice();
    }

    if (mode === 'major') return fromTable(MAJOR_KEYS, MAJOR_KEYS);
    if (mode === 'naturalMinor')
      return fromTable(NATURAL_MINOR_KEYS, NATURAL_MINOR_KEYS);
    if (mode === 'jazzMinor')
      return fromTable(JAZZ_MINOR_KEYS, JAZZ_MINOR_KEYS);
    if (mode === 'harmonicMinor')
      return fromTable(HARMONIC_MINOR_KEYS, HARMONIC_MINOR_KEYS);
    if (mode === 'dorian') return fromTable(DORIAN_KEYS, DORIAN_KEYS);
    if (mode === 'mixolydian')
      return fromTable(MIXOLYDIAN_KEYS, MIXOLYDIAN_KEYS);
    if (mode === 'minorPent')
      return fromTable(MINOR_PENT_KEYS, MINOR_PENT_KEYS);
    if (mode === 'blues') return fromTable(BLUES_KEYS, BLUES_KEYS);
    if (mode === 'wholeTone')
      return fromTable(WHOLE_TONE_KEYS, WHOLE_TONE_KEYS);
    if (mode === 'halfWholeDim')
      return fromTable(HALF_WHOLE_DIM_KEYS, HALF_WHOLE_DIM_KEYS);

    return fromTable(MAJOR_KEYS, MAJOR_KEYS);
  }

  // Chromatic order of pitch classes for cycling through scales
  const CHROMATIC_ORDER = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Map pitch class (0-11) to written key name
  function pcToWrittenKeyName(pc) {
    return CHROMATIC_ORDER[pc] || 'C';
  }

  // Map written key name back to pitch class
  function writtenKeyNameToPc(name) {
    const idx = CHROMATIC_ORDER.indexOf(name);
    if (idx >= 0) return idx;
    // Handle enharmonic equivalents
    const enharmonics = {
      'C#': 1, 'D#': 3, 'E#': 5, 'F#': 6, 'G#': 8, 'A#': 10, 'B#': 0,
      'Cb': 11, 'Fb': 4
    };
    return enharmonics[name] !== undefined ? enharmonics[name] : 0;
  }

  // Advance to the next chromatic scale after completing current one
  function advanceToNextScale() {
    const ls = window.SCALE_APP && window.SCALE_APP.listenState;
    if (!ls) {
      console.warn('[Listen] No listenState for advanceToNextScale');
      return;
    }

    const txSelect = $('transpositionSelect');
    const scaleTypeSelect = $('scaleTypeSelect');
    if (!txSelect || !scaleTypeSelect) {
      console.warn('[Listen] Dropdowns not found for advanceToNextScale');
      return;
    }

    const txId = txSelect.value;
    const tx = findTranspositionById(txId);
    const scaleType = findScaleTypeById(scaleTypeSelect.value);
    if (!tx || !scaleType) {
      console.warn('[Listen] Could not resolve transposition or scale type');
      return;
    }

    // Get current written pitch class and advance by 1 semitone
    const currentWrittenPc = ls.writtenPc;
    const nextWrittenPc = wrapPc(currentWrittenPc + 1);
    const nextWrittenKeyName = pcToWrittenKeyName(nextWrittenPc);

    // Get scale notes for the new key
    const scaleNoteNames = findScaleNotesForType(nextWrittenKeyName, scaleType);
    const clef = tx.clef || 'treble';
    const upDownWithOctaves = buildUpDownOctaveSequence(scaleNoteNames, clef);

    // Build timing slots (same as lockTonic)
    const notesForSlots = [];
    const patternLen = LISTEN_PATTERN.length;
    for (let i = 0; i < patternLen; i += 1) {
      const idx = Math.min(i, upDownWithOctaves.length - 1);
      notesForSlots.push(upDownWithOctaves[idx]);
    }

    const bpm = state.bpm;
    const baseBeatMs = 60000 / bpm;

    let t = 0;
    const slots = [];
    for (let i = 0; i < patternLen; i += 1) {
      const lenUnits = LISTEN_PATTERN[i];
      const startMs = t;
      const endMs = t + lenUnits * baseBeatMs;

      const note = notesForSlots[i];
      slots.push({
        index: i,
        expectedNote: note,
        startMs: startMs,
        endMs: endMs,
        detectedPitchHz: null,
        pitchErrorCents: null,
        timingErrorMs: null,
      });

      t = endMs;
    }

    // Concert pitch class (for reference, though we're working in written space)
    const concertPc = wrapPc(nextWrittenPc - tx.offset);

    // Update listenState for the new scale
    ls.writtenPc = nextWrittenPc;
    ls.writtenKeyName = nextWrittenKeyName;
    ls.concertPc = concertPc;
    ls.slots = slots;
    ls.currentIndex = 0;
    ls.progressState = 'idle';
    ls.noteSequence = upDownWithOctaves;

    // Clear feedback
    if (ls.expectedNotes) {
      ls.expectedNotes.forEach(function (n) {
        if (n) n.feedback = null;
      });
    }

    // Update the tonic reference (approximate — use the tonic frequency shifted by 1 semitone)
    if (ls.tonic && typeof ls.tonic.freq === 'number') {
      const semitoneRatio = Math.pow(2, 1 / 12);
      ls.tonic.freq = ls.tonic.freq * semitoneRatio;
      ls.tonic.midi = (ls.tonic.midi || 60) + 1;
      ls.tonic.pc = wrapPc((ls.tonic.pc || 0) + 1);
      ls.tonic.writtenPc = nextWrittenPc;
      ls.tonic.writtenKeyName = nextWrittenKeyName;
      ls.tonic.concertPc = concertPc;
    }

    // Render the new scale staff
    renderActiveScaleStaff(upDownWithOctaves, clef);

    // Update status display
    const label = nextWrittenKeyName + ' ' + scaleType.label;
    const activeStatus = document.getElementById('activeScaleStatus');
    if (activeStatus) {
      activeStatus.textContent = label;
    }

    console.log('[Listen] Advanced to', label);
  }

  function lockTonic(freq, tuningDesc) {
    const midi = freqToMidi(freq);
    const pc = midiToPc(midi);
    const octave = Math.floor(midi / 12) - 1;

    const txSelect = $('transpositionSelect');
    const scaleTypeSelect = $('scaleTypeSelect');
    if (!txSelect || !scaleTypeSelect) {
      console.warn('Transposition or scale type select not found.');
      stopListening();
      return;
    }

    const txId = txSelect.value;
    const tx = findTranspositionById(txId);
    const scaleType = findScaleTypeById(scaleTypeSelect.value);
    if (!tx || !scaleType) {
      console.warn('Could not resolve transposition or scale type for listen mode.');
      stopListening();
      return;
    }

    const concertPc = pc;
    const writtenPc = wrapPc(concertPc + tx.offset);

    const writtenKey = findMajorKeyByPc(writtenPc);
    const writtenKeyName = writtenKey ? writtenKey.name : pcToWrittenKeyName(writtenPc);

    // Show calibration feedback
    const tuningFeedback = tuningDesc || '';
    const activeStatus = document.getElementById('activeScaleStatus');
    if (activeStatus) {
      activeStatus.textContent = writtenKeyName + tuningFeedback + ' — starting...';
    }

    const scaleNoteNames = findScaleNotesForType(writtenKeyName, scaleType);
    const clef = tx.clef || 'treble';
    const upDownWithOctaves = buildUpDownOctaveSequence(
      scaleNoteNames,
      clef
    );

    const notesForSlots = [];
    const patternLen = LISTEN_PATTERN.length;
    for (let i = 0; i < patternLen; i += 1) {
      const idx = Math.min(i, upDownWithOctaves.length - 1);
      notesForSlots.push(upDownWithOctaves[idx]);
    }

    const bpm = state.bpm;
    const baseBeatMs = 60000 / bpm;

    let t = 0;
    const slots = [];
    for (let i = 0; i < patternLen; i += 1) {
      const lenUnits = LISTEN_PATTERN[i];
      const startMs = t;
      const endMs = t + lenUnits * baseBeatMs;

      const note = notesForSlots[i];
      slots.push({
        index: i,
        expectedNote: note,
        startMs: startMs,
        endMs: endMs,
        detectedPitchHz: null,
        pitchErrorCents: null,
        timingErrorMs: null,
      });

      t = endMs;
    }

    state.mode = 'captured_tonic';
    state.tonic = {
      freq: freq,
      midi: midi,
      pc: pc,
      octave: octave,
      concertPc: concertPc,
      writtenPc: writtenPc,
      writtenKeyName: writtenKeyName,
      scaleTypeId: scaleType.id,
    };
    state.slots = slots;

    if (!window.SCALE_APP) {
      window.SCALE_APP = {};
    }

    const grid = window.SCALE_APP.grid || null;
    let matchedRow = null;

    if (grid && Array.isArray(grid.rows)) {
      matchedRow =
        grid.rows.find(function (r) {
          return (
            r &&
            r.writtenKeyName === writtenKeyName &&
            r.clef === clef
          );
        }) || null;
    }

    window.SCALE_APP.listenState = {
      tonic: state.tonic,
      slots: state.slots,
      bpm: state.bpm,
      pattern: LISTEN_PATTERN.slice(),
      writtenKeyName: writtenKeyName,
      scaleTypeId: scaleType.id,
      transpositionId: txId,
      concertPc: concertPc,
      writtenPc: writtenPc,
      clef: clef,
      rowId: matchedRow ? matchedRow.id : null,
      expectedNotes:
        matchedRow && Array.isArray(matchedRow.expectedNotes)
          ? matchedRow.expectedNotes
          : [],
      currentIndex: 0,

      // Progressor/tuner state:
      nonRedStreak: 0,
      wasLoud: false,
      lastDegreeIndex: null,
      degreeStreak: 0,
      lastOnsetDegreeIndex: null,
      prevRms: 0,
      lastOnsetTimeMs: 0,
      lastActiveTimeMs: 0,
      tuner: {
        degreeIndex: null,
        centsOffset: 0,
        isLoud: false,
        confidence: 0,
      },

          // noteSequence will be filled by renderActiveScaleStaff
    };

    // Render the full active scale staff in the Magic Box
    renderActiveScaleStaff(upDownWithOctaves, clef);

    // Now start following the scale with the updated listenState.expectedNotes
    startFollowingScale();

    const label = writtenKeyName + ' ' + scaleType.label;
    if (activeStatus) {
      activeStatus.textContent = label;
    }
    console.log(
      '[Listen] Detected tonic ~ ' +
        freq.toFixed(1) +
        ' Hz (MIDI ' +
        midi +
        ') → ' +
        label +
        '. Built ' +
        slots.length +
        ' timing slots at ' +
        bpm +
        ' BPM.'
    );
  }

  function startFollowingScale() {
    const ac = ensureAudioContext();
    if (!ac) return;

    const profile = getListenProfile();
    const isVoice = profile === 'voice';
    console.log('[Listen] startFollowingScale with profile =', profile);

    state.mode = 'following_scale';
    state.lastStableFreq = null;
    state.stableFrames = 0;
    state.lastNoteMidi = null;
    state.followFreqBuffer = [];

    // Reuse existing mic stream if available (from tonic detection phase)
    // This avoids triggering a second permission dialog
    if (state.micSource && state.analyser) {
      console.log('[Listen] Reusing existing mic stream for follow mode');
      // Adjust smoothing for follow mode profile
      state.analyser.smoothingTimeConstant = isVoice ? 0.9 : 0.8;
      const buffer = new Float32Array(state.analyser.fftSize);
      startFollowLoop(ac, buffer);
      return;
    }

    // No existing stream — request one (this path typically won't be hit
    // since tonic detection already opened the mic)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      updateStatus('Microphone not available in this browser.');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        const source = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = isVoice ? 0.9 : 0.8;

        source.connect(analyser);

        state.micSource = source;
        state.analyser = analyser;

        const buffer = new Float32Array(analyser.fftSize);
        startFollowLoop(ac, buffer);
      })
      .catch(function (err) {
        console.error('Error accessing microphone for follow mode', err);
        updateStatus('Could not access microphone for follow mode.');
        if (state.buttonEl) {
          state.buttonEl.disabled = false;
          state.buttonEl.textContent = 'Listen';
        }
        state.mode = 'idle';
      });
  }

  // Extracted follow-mode frame loop so it can be called from both paths
  function startFollowLoop(ac, buffer) {
    function frame() {
      if (state.mode !== 'following_scale' || !state.analyser) {
        return;
      }

      const profile = getListenProfile();
      const isVoice = profile === 'voice';

      const rmsThreshold = isVoice
        ? 0.0005
        : (typeof LISTEN_MIN_RMS === 'number' ? LISTEN_MIN_RMS : 0.0015);

      state.analyser.getFloatTimeDomainData(buffer);

      const rms = computeRms(buffer);
      const ls =
        (window.SCALE_APP && window.SCALE_APP.listenState) || null;

      if (!ls || !ls.expectedNotes || !ls.expectedNotes.length) {
        state.rafId = requestAnimationFrame(frame);
        return;
      }

      const isLoud = rms >= rmsThreshold;

      if (!ls.tuner) {
        ls.tuner = {
          degreeIndex: null,
          centsOffset: 0,
          freqHz: 0,
          isLoud: false,
          confidence: 0,
        };
      }

      // In debug mode, we do NOT early-return on "not loud".
      if (!isLoud && !isDebugAcceptAnyNote()) {
        ls.tuner.isLoud = false;
        ls.tuner.degreeIndex = null;
        ls.tuner.centsOffset = 0;
        ls.tuner.confidence = 0;
        ls.wasLoud = false;
        ls.degreeStreak = 0;
        ls.lastDegreeIndex = null;
        ls.prevRms = rms;
        state.rafId = requestAnimationFrame(frame);
        return;
      }

      const freq = detectPitch(buffer, ac.sampleRate);
      if (!freq || freq < MIN_FREQ_HZ || freq > MAX_FREQ_HZ) {
        state.rafId = requestAnimationFrame(frame);
        return;
      }

      // Smooth over a tiny rolling buffer so we react to musical intention,
      // not single-frame jitter.
      const MAX_BUFFER = 7;
      if (!Array.isArray(state.followFreqBuffer)) {
        state.followFreqBuffer = [];
      }
      const fbuf = state.followFreqBuffer;
      fbuf.push(freq);
      if (fbuf.length > MAX_BUFFER) fbuf.shift();

      let smoothedFreq = freq;
      if (fbuf.length >= 3) {
        const sorted = fbuf.slice().sort(function (a, b) { return a - b; });
        const median = sorted[Math.floor(sorted.length / 2)];
        const low = sorted[0];
        const high = sorted[sorted.length - 1];

        // If the buffer is wildly spread (e.g., harmonic jump),
        // skip this frame instead of feeding garbage to the evaluator.
        const spreadCents = 1200 * Math.log2(high / low);
        if (spreadCents > 150) {
          state.rafId = requestAnimationFrame(frame);
          return;
        }

        smoothedFreq = median;
      }

      // ─────────────────────────────────────────
      // Tuner Brain: map pitch → closest degree + cents
      // ─────────────────────────────────────────
      const notes = ls.expectedNotes || [];
      let closestIdx = null;
      let centsOffset = 0;

      if (notes.length) {
        const detectedMidi = freqToMidi(smoothedFreq);
        let bestDegree = -1;
        let bestAbsErr = Infinity;
        let bestErrCents = 0;

        for (let i = 0; i < notes.length; i += 1) {
          const n = notes[i];
          if (!n) continue;

          let baseMidi =
            typeof n.midi === 'number' && Number.isFinite(n.midi)
              ? n.midi
              : (typeof n.freq === 'number' && n.freq > 0
                  ? freqToMidi(n.freq)
                  : null);

          if (baseMidi == null) continue;

          // Find nearest octave for this degree to the detected pitch.
          let bestMidiForNote = baseMidi;
          let bestDiff = Math.abs(detectedMidi - baseMidi);

          for (let k = -3; k <= 3; k += 1) {
            if (k === 0) continue;
            const cand = baseMidi + 12 * k;
            const diff = Math.abs(detectedMidi - cand);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestMidiForNote = cand;
            }
          }

          const freqForNote = midiToFreq(bestMidiForNote);
          const errCents = 1200 * Math.log2(smoothedFreq / freqForNote);
          const absErr = Math.abs(errCents);

          if (absErr < bestAbsErr) {
            bestAbsErr = absErr;
            bestErrCents = errCents;
            bestDegree = i;
          }
        }

        if (bestDegree >= 0) {
          closestIdx = bestDegree;
          centsOffset = bestErrCents;
        }
      }

      // Update tuner snapshot
      ls.tuner.degreeIndex = closestIdx;
      ls.tuner.centsOffset = centsOffset;
      ls.tuner.freqHz = smoothedFreq;
      ls.tuner.isLoud = true;

      // Live tuner readout in follow mode.
      if (closestIdx != null) {
        const midi = freqToMidi(smoothedFreq);
        const noteLabel = midiToNoteName(midi);
        updateTuner(noteLabel + ' · ' + smoothedFreq.toFixed(1) + ' Hz', centsOffset);
      } else {
        updateTuner('', null);
      }

      // Stability / confidence (how long we've been on this degree)
      const prevDegree = ls.lastDegreeIndex;
      const MIN_DEGREE_STABLE_FRAMES = 2;

      if (closestIdx != null && closestIdx === prevDegree) {
        ls.degreeStreak = (ls.degreeStreak || 0) + 1;
      } else {
        ls.lastDegreeIndex = closestIdx;
        ls.degreeStreak = closestIdx != null ? 1 : 0;
      }

      ls.tuner.confidence =
        ls.degreeStreak > 0
          ? Math.min(1, ls.degreeStreak / MIN_DEGREE_STABLE_FRAMES)
          : 0;

      // ─────────────────────────────────────────
      // Progressor Brain: detect onsets (loudness + pitch change)
      // ─────────────────────────────────────────
      const nowMs =
        (typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now();

      // If we've gone too long without any pitch activity, reset the scale.
      const RESET_TIMEOUT_MS = 5000; // 5 seconds of inactivity
      const lastActivity =
        ls && typeof ls.lastActiveTimeMs === 'number'
          ? ls.lastActiveTimeMs
          : (typeof ls.lastOnsetTimeMs === 'number' ? ls.lastOnsetTimeMs : 0);

      if (
        ls &&
        lastActivity > 0 &&
        nowMs - lastActivity > RESET_TIMEOUT_MS
      ) {
        ls.lastOnsetTimeMs = 0;
        ls.currentIndex = 0;
        ls.progressState = 'idle';

        if (ls.expectedNotes && ls.expectedNotes.length) {
          ls.expectedNotes.forEach(function (n) {
            if (n) n.feedback = null;
          });
        }

        if (ls.noteSequence && ls.noteSequence.length) {
          renderActiveScaleStaff(ls.noteSequence, ls.clef || 'treble');
        }
      }

      // DEBUG path: very simple time-gap onset.
      if (isDebugAcceptAnyNote()) {
        const lastTime =
          typeof ls.lastOnsetTimeMs === 'number' ? ls.lastOnsetTimeMs : 0;
        const MIN_DEBUG_GAP_MS = 130;

        let isOnset = false;
        if (closestIdx != null) {
          if (!lastTime || nowMs - lastTime >= MIN_DEBUG_GAP_MS) {
            isOnset = true;
          }
        }

        if (isOnset) {
          ls.lastOnsetTimeMs = nowMs;
          ls.lastOnsetDegreeIndex = closestIdx;

          try {
            handleNoteEvent({
              degreeIndex: closestIdx,
              centsOffset: centsOffset,
              freqHz: smoothedFreq,
            });
          } catch (e) {
            console.error('[Listen][DEBUG_ANY] handleNoteEvent error', e);
          }
        }

        ls.wasLoud = isLoud;
        ls.prevRms = rms;
        state.rafId = requestAnimationFrame(frame);
        return;
      }

      // NORMAL path: conservative onset detection based on loudness + pitch change.
      const wasLoud = !!ls.wasLoud;
      const prevRms =
        typeof ls.prevRms === 'number' ? ls.prevRms : 0;

      const ATTACK_DELTA_FACTOR = 0.25;

      const strongAttack =
        isLoud &&
        rms >= rmsThreshold &&
        rms > prevRms * (1 + ATTACK_DELTA_FACTOR);

      // A. Loudness-based onset (tongued notes): quiet→loud or strong attack.
      const loudOnset =
        closestIdx != null &&
        ((!wasLoud && isLoud) || strongAttack);

      // B. Pitch-change onset (slurred notes): loud→loud + stable new degree.
      const pitchOnset =
        wasLoud &&
        isLoud &&
        closestIdx != null &&
        closestIdx !== ls.lastOnsetDegreeIndex &&
        ls.degreeStreak >= MIN_DEGREE_STABLE_FRAMES;

      const isOnset = loudOnset || pitchOnset;

      if (isOnset) {
        ls.lastOnsetDegreeIndex = closestIdx;
        ls.lastOnsetTimeMs = nowMs;

        try {
          handleNoteEvent({
            degreeIndex: closestIdx,
            centsOffset: centsOffset,
            freqHz: smoothedFreq,
          });
        } catch (e) {
          console.error('[Listen] handleNoteEvent error', e);
        }
      }

      // Remember loudness + RMS for next frame.
      ls.wasLoud = isLoud;
      ls.prevRms = rms;

      state.rafId = requestAnimationFrame(frame);
    }

    state.rafId = requestAnimationFrame(frame);
  }
  function initListenMode() {
    state.statusEl = $('listenStatus');
    state.buttonEl = $('listenButton');
    state.buttonLabelEl = state.buttonEl
      ? state.buttonEl.querySelector('.listen-strip-label')
      : null;
    state.panelEl = document.querySelector('.listen-panel');
    state.activeBoxEl = $('activeScaleBox');
    state.activeStageEl = $('activeScaleStage');

    console.log(
      '[Listen] initListenMode: statusEl =',
      !!state.statusEl,
      ', buttonEl =',
      !!state.buttonEl
    );

    if (!state.statusEl || !state.buttonEl) {
      return;
    }

    state.buttonEl.addEventListener('click', function () {
      if (state.mode === 'idle') {
        startListeningForTonic();
      } else {
        stopListening();
      }
    });

    // Re-render the active scale staff when the window resizes
    window.addEventListener('resize', function () {
      if (!window.SCALE_APP || !window.SCALE_APP.listenState) return;
      const ls = window.SCALE_APP.listenState;
      if (!ls || !ls.noteSequence || !ls.noteSequence.length) return;
      renderActiveScaleStaff(ls.noteSequence, ls.clef || 'treble');
    });

    updateStatus('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initListenMode);
  } else {
    initListenMode();
  }


})();