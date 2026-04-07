// CAMBIOS MANUALES NECESARIOS EN public/app.js
// Sigue estas instrucciones para completar la integración de audio

// ============================================================================
// CAMBIO 1: En state.ws.onopen - DESPUÉS de setConnectionStatus
// ============================================================================
// Busca esta línea (aproximadamente línea 125):
//   setConnectionStatus('connected', 'Conectado');
//
// Y justo después, agrega:
//   audio.init();
//   updateSoundButton();
//
// El código debe verse así:
/*
    setConnectionStatus('connected', 'Conectado');
    
    // Initialize audio and update button UI.
    audio.init();
    updateSoundButton();

    // If reconnecting mid-session...
*/

// ============================================================================
// CAMBIO 2: En el handler de 'answer:ack' - AGREGA SONIDO CORRECTO
// ============================================================================
// Busca esta sección (aproximadamente línea 203):
//    if (msg.type === 'answer:ack') {
//      $('answer-status').textContent = 'Respuesta enviada.';
//      return;
//    }
//
// Reemplazala por:
/*
    if (msg.type === 'answer:ack') {
      $('answer-status').textContent = 'Respuesta enviada.';
      audio.playCorrect();
      return;
    }
*/

// ============================================================================
// CAMBIO 3: En renderRoundResult() - AGREGA SONIDO DE FIN DE RONDA
// ============================================================================
// Busca esta función (aproximadamente línea 478):
//    function renderRoundResult(msg) {
//      clearInterval(state.timerInt);
//      state.timerInt = null;
//
// Y justo después de limpiar los timers, agrega:
/*
  function renderRoundResult(msg) {
    clearInterval(state.timerInt);
    state.timerInt = null;
    
    // Play round end sound.
    audio.playRoundEnd();

    $('results-title').textContent = 'Fin de ronda';
*/

// ============================================================================
// CAMBIO 4: Al final de app.js - AGREGAR EVENTO DEL BOTÓN DE SONIDO
// ============================================================================
// Ve al final del archivo, efter de todos los event listeners
// (después de la línea con 'btn-back-home' onclick)
// Y agrega:
/*
// Sound toggle button.
$('btn-sound-toggle').onclick = () => {
  audio.toggleSound();
};

// Initialize sound system on page load.
audio.init();
updateSoundButton();
*/

// ============================================================================
// VERIFICACIÓN FINAL
// ============================================================================
// Después de los cambios, valida con:
//   node --check public/app.js
// 
// No debe haber errores de sintaxis.
