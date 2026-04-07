#!/bin/bash
# Script para integrar audio en Quiz Arena

set -e

echo "📦 Integrando sistema de audio en Quiz Arena..."
echo ""

# Backup de archivo original
cp public/index.html public/index.html.bak
cp public/styles.css public/styles.css.bak
echo "✅ Backups creados: index.html.bak, styles.css.bak"
echo ""

# 1. Actualizar index.html - Agregar botón de sonido y cargar audio.js
echo "🔧 Actualizando index.html..."

# Insertar botón de sonido después de ws-status
sed -i.tmp '/<p id="ws-status"/a\      <button id="btn-sound-toggle" class="sound-btn" title="Alternar sonido">🔊 Sonido</button>' public/index.html

# Cambiar los scripts finales para incluir audio.js primero
sed -i.tmp 's|<script src="/app.js" defer></script>|<script src="/audio.js" defer></script>\n    <script src="/app.js" defer></script>|' public/index.html

echo "✅ index.html actualizado"
echo ""

# 2. Actualizar styles.css - Agregar estilos del botón
echo "🔧 Actualizando styles.css..."

cat >> public/styles.css << 'EOF'

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
EOF

echo "✅ styles.css actualizado"
echo ""

# 3. Actualizar app.js - Agregar soundEnabled al state
echo "🔧 Actualizando app.js..."

# Agregar soundEnabled después de connectWatchdog en el state
sed -i.tmp '/connectWatchdog: null,/a\  soundEnabled: localStorage.getItem("soundEnabled") !== "false",' public/app.js

echo "✅ app.js actualizado (soundEnabled agregado)"
echo ""

echo "🎵 Sistema de audio integrado correctamente!"
echo ""
echo "Cambios realizados:"
echo "  ✓ Crear archivo: public/audio.js (módulo de audio)"
echo "  ✓ Actualizar: public/index.html (botón + scripts)"
echo "  ✓ Actualizar: public/styles.css (estilos del botón)"
echo "  ✓ Actualizar: public/app.js (soundEnabled en state)"
echo ""
echo "⚠️  Cambios manuales pendientes en public/app.js:"
echo "  1. En state.ws.onopen, después de setConnectionStatus(), agrega:"
echo "     audio.init();"
echo "     updateSoundButton();"
echo ""
echo "  2. En el handler answer:ack, agrega:"
echo "     audio.playCorrect();"
echo ""
echo "  3. En renderRoundResult(), al inicio, agrega:"
echo "     audio.playRoundEnd();"
echo ""
echo "  4. Al final de app.js, agrega:"
echo "     \$('btn-sound-toggle').onclick = () => {"
echo "       audio.toggleSound();"
echo "     };"
echo ""
echo "📚 Ver AUDIO_INTEGRATION.md para detalles completos"
echo ""
