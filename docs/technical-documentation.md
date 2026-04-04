# Documentacion Tecnica - Quiz Arena

## 1. Objetivo tecnico
Quiz Arena es una aplicacion web multijugador de baja latencia para partidas tipo trivial por salas. El sistema esta optimizado para ejecutarse en una sola instancia Node.js con un modelo event-driven y transporte realtime sobre WebSocket.

## 2. Arquitectura general
- Backend: Node.js + Fastify.
- Realtime: @fastify/websocket sobre endpoint unico `/ws`.
- Frontend: HTML/CSS/JavaScript vanilla servido como estatico.
- Datos de preguntas: archivo JSON local (`data/questions.json`).
- Persistencia de partidas: memoria RAM (Map en proceso).

Flujo tecnico:
1. El host crea sala con `host:create`.
2. El servidor crea codigo unico de sala y responde estado.
3. Los jugadores se unen con `player:join`.
4. El host inicia partida con `host:start`.
5. El servidor emite preguntas, cronometra rondas y puntua.
6. Al terminar, emite ranking final y cierra la sesion logica.

## 3. Estructura de carpetas
- `server.js`: servidor HTTP/WS y logica de juego.
- `public/index.html`: estructura de pantallas.
- `public/styles.css`: estilos responsive.
- `public/app.js`: cliente realtime y renderizado UI.
- `scripts/generate-questions.js`: generador deterministico de dataset.
- `data/questions.json`: banco de preguntas (1210 actualmente).
- `README.md`: guia de uso.

## 4. Backend (`server.js`)
### 4.1 Componentes principales
- `rooms` (Map): estado global en memoria de salas activas.
- `room`:
  - `code`, `hostId`, `status`, `currentRound`, `currentQuestion`.
  - `players`: Map de jugadores conectados.
  - `questions`: subset aleatorio para la partida.
  - `answers`: respuestas de la ronda en curso.
  - `timers`: referencias a `setTimeout` para gestion de tiempos.

### 4.2 Servicios HTTP
- `GET /api/health`: estado del servicio.
- `GET /api/questions/count`: total de preguntas cargadas.
- `GET /api/network`: interfaces locales para construir URL de union.
- `GET /api/qr?url=...`: genera SVG QR para enlace de sala.
- `GET /`: entrega pagina principal.

### 4.3 Canal realtime WebSocket
Endpoint: `/ws`

Mensajes de entrada:
- `host:create`: crea sala y registra host.
- `player:join`: une jugador por codigo.
- `host:start`: inicia partida.
- `answer`: envia respuesta de jugador.
- `ping`: keep-alive.

Mensajes de salida:
- `state:lobby`: estado de sala/jugadores.
- `game:question`: enunciado, opciones, tiempo.
- `game:round_result`: solucion y ranking parcial.
- `game:over`: ranking final.
- `error`: validaciones/errores de protocolo.
- `pong`: respuesta keep-alive.

### 4.4 Logica de puntuacion
La puntuacion prioriza acierto y rapidez:
- Si la respuesta es incorrecta, puntua 0.
- Si es correcta, el score usa una base + bonus por tiempo restante.

Modelo aproximado:
$$
\text{puntos} = 100 + \left\lfloor 100 \cdot \frac{t_{restante}}{t_{ronda}} \right\rfloor
$$

## 5. Frontend (`public/app.js`)
### 5.1 Responsabilidades
- Gestion de conexion WebSocket.
- Serializacion/deserializacion de eventos JSON.
- Render de pantallas: home, lobby, pregunta, resultados.
- Gestión de interaccion del host y jugadores.
- Temporizador visual de ronda.

### 5.2 Estado cliente
Estado minimizado en memoria:
- identificacion local (`clientId`, `role`, `roomCode`)
- estado de partida (`round`, `totalRounds`, `selectedAnswer`)
- datos de interfaz (`players`, `scores`, `question`)

## 6. Dataset de preguntas
Origen: `scripts/generate-questions.js`.

Propiedades:
- Generacion deterministica con seed fija.
- Categorias: matematicas, porcentajes, secuencias, geografia, ciencia.
- Estructura por item:
  - `id`
  - `category`
  - `question`
  - `options` (array)
  - `answerIndex` (indice de opcion correcta)

## 7. Rendimiento y escalabilidad
### 7.1 Decisiones de rendimiento
- Fastify por throughput alto y bajo overhead.
- Un unico proceso con estructuras en memoria para latencia baja.
- Frontend sin framework para minimizar peso inicial.
- Mensajes WS pequenos en JSON.

### 7.2 Limites actuales
- Estado volatile: si reinicia el proceso se pierden salas activas.
- Sin balanceo horizontal nativo (estado local en RAM).
- Sin autenticacion fuerte de usuarios.

### 7.3 Escalado recomendado
1. Externalizar estado de salas a Redis.
2. Añadir persistencia de historico de partidas (PostgreSQL/Mongo).
3. Introducir autenticacion de host (token o passcode).
4. Aplicar rate limiting por IP/evento.
5. Instrumentar metricas (prom-client + Grafana).

## 8. Seguridad basica
- Sanitizacion de nombres de jugador.
- Validaciones de payload y tipos por mensaje.
- Rechazo de acciones no permitidas por rol/estado.
- Evitar exponer datos de respuesta correcta antes de tiempo.

## 9. Ejecucion local
1. Instalar dependencias: `npm install`
2. Generar preguntas: `npm run questions:generate`
3. Iniciar servidor: `npm run dev`
4. Abrir en navegador: `http://localhost:3000`

## 10. Mejoras tecnicas propuestas
1. Tests unitarios sobre logica de puntuacion y rondas.
2. Tests de contrato del protocolo WS.
3. Reconexion automatica con rejoin de cliente.
4. Control de desconexion del host y migracion de host.
5. Internacionalizacion de preguntas y UI.
