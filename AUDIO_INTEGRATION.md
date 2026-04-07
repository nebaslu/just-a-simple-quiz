# Integración de Audio - Cambios Necesarios

## 1. Actualizar public/index.html

### Paso 1: Agregar button de sonido después de ws-status

Encuentra esta línea:
```html
<p id="ws-status" class="ws-status ws-connecting">Conectando...</p>
```

Y justo después, agrega:
```html
<button id="btn-sound-toggle" class="sound-btn" title="Alternar sonido">🔊 Sonido</button>
```

### Paso 2: Cargar módulo de audio antes de app.js

En el final del `<body>`, reemplaza:
```html
<script src="/app.js" defer></script>
```

Por:
```html
<script src="/audio.js" defer></script>
<script src="/app.js" defer></script>
```

---

## 2. Actualizar public/app.js

### Paso 1: Agregar soundEnabled al state

En la sección `const state = {`, añade:
```javascript
soundEnabled: localStorage.getItem('soundEnabled') !== 'false',
```

### Paso 2: Inicializar audio en onopen del WebSocket

En la función `state.ws.onopen`, después de `setConnectionStatus('connected', 'Conectado');`, agrega:
```javascript
audio.init();
updateSoundButton();
```

### Paso 3: Reproducir sonido cuando respuesta es enviada

En el handler `answer:ack`, reemplaza:
```javascript
if (msg.type === 'answer:ack') {
  $('answer-status').textContent = 'Respuesta enviada.';
  return;
}
```

Por:
```javascript
if (msg.type === 'answer:ack') {
  $('answer-status').textContent = 'Respuesta enviada.';
  audio.playCorrect();
  return;
}
```

### Paso 4: Reproducir sonido al terminar ronda

En `renderRoundResult()`, al inicio, agrega:
```javascript
audio.playRoundEnd();
```

### Paso 5: Agregar evento click al botón de sonido

Al final de app.js (en la sección de event listeners), agrega:
```javascript
// Sound toggle button.
$('btn-sound-toggle').onclick = () => {
  audio.toggleSound();
};
```

---

## 3. Actualizar public/styles.css

### Agregar estilos para el botón de sonido

Al final del archivo, agrega:
```css
/* Sound toggle button in corner. */
.sound-btn {
  position: fixed;
  top: 12px;
  left: 12px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #ffffffd9;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  z-index: 25;
  transition: all 0.2s ease;
}

.sound-btn:hover {
  background: #fff;
  transform: scale(1.05);
}

.sound-btn.muted {
  opacity: 0.6;
}
```

---

## ✅ Sonidos Disponibles

El módulo `audio.js` proporciona:
- `audio.playCorrect()` - Tono de acierto (ascendente)
- `audio.playWrong()` - Tono de error (descendente)
- `audio.playRoundEnd()` - Notificación de fin de ronda
- `audio.playGameStart()` - Sonido de inicio de partida
- `audio.toggleSound()` - Mute/unmute global

Todos usan Web Audio API (sin archivos externos necesarios).
