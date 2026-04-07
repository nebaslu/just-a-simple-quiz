# Quiz Arena (Web Trivial Multijugador)

Juego tipo trivial optimizado para rendimiento y multiplataforma (movil, tablet, PC, TV Android con navegador).

## Caracteristicas

- Backend en Fastify + WebSocket (sin sobrecarga de framework pesado en frontend).
- Sala multijugador por codigo corto (6 caracteres).
- Unirse por URL o escaneando QR.
- Preguntas en tiempo real con temporizador y puntuacion por velocidad.
- Frontend responsive en HTML/CSS/JS puro.
- Base inicial de 1000+ preguntas en JSON.

## Requisitos

- Node.js 18+

## Instalacion

```bash
npm install
```

## Generar preguntas (1000+)

```bash
npm run questions:generate
```

Archivo generado: `data/questions.json`

## Ejecutar

```bash
npm run dev
```

El servidor se reinicia automaticamente cuando cambias `server.js` o archivos JSON en `data/`.

Servidor por defecto: `http://localhost:3000`

## Jugar en otros dispositivos de la red

1. Inicia el servidor en tu equipo.
2. Abre la app y crea una sala como anfitrion.
3. Comparte el QR o la URL con otros jugadores conectados a la misma red.
4. Desde movil/tablet/TV abren la URL o escanean el QR y se unen.

## Variables opcionales

- `PORT`: puerto del servidor (por defecto `3000`)
- `QUESTIONS_PER_MATCH`: rondas por partida (por defecto `10`)
- `ROUND_MS`: duracion de cada pregunta en ms (por defecto `30000`)

## Formato de preguntas

Cada entrada del JSON tiene esta estructura:

```json
{
  "id": "q_0001",
  "category": "Matematicas",
  "difficulty": "facil",
  "question": "Cuanto es 3 + 5?",
  "options": ["8", "7", "6", "9"],
  "answerIndex": 0,
  "explanation": "El resultado correcto es 8."
}
```
