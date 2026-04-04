# Documentacion Funcional - Quiz Arena

## 1. Vision del producto
Quiz Arena permite jugar partidas de preguntas y respuestas en tiempo real, con un anfitrion (host) que crea la sala y varios jugadores que se unen por codigo, URL o QR.

## 2. Tipos de usuario
- Host:
  - Crea sala.
  - Comparte enlace/codigo/QR.
  - Inicia partida.
- Jugador:
  - Se une a sala existente.
  - Responde preguntas dentro del tiempo limite.
  - Visualiza ranking parcial y final.

## 3. Flujo funcional principal
1. Pantalla inicial:
- El host introduce su nombre y crea sala.
- El jugador introduce nombre + codigo para unirse.

2. Lobby:
- Se muestra codigo de sala.
- Se muestra enlace de union y QR.
- Se lista quien esta conectado.
- El host inicia la partida cuando haya suficientes jugadores.

3. Rondas de preguntas:
- Se presenta una pregunta con 4 opciones.
- Cada jugador selecciona una respuesta.
- Existe un temporizador visible.

4. Resultado de ronda:
- Se revela respuesta correcta.
- Se actualiza ranking con puntuacion acumulada.

5. Fin de partida:
- Se muestra clasificacion final.
- Los participantes pueden volver al inicio para nueva partida.

## 4. Reglas funcionales
- El codigo de sala identifica una partida activa.
- Los jugadores no pueden iniciar partida (solo host).
- Cada ronda tiene tiempo limitado.
- La puntuacion premia acierto y rapidez.
- Gana quien acumula mas puntos al final de todas las rondas.

## 5. Estados de pantalla
- `Inicio`: crear/unirse a sala.
- `Lobby`: espera y preparacion.
- `Pregunta`: fase de respuesta.
- `Resultados`: resultado de ronda o final.

## 6. Casos de uso clave
### UC-01: Crear sala
- Actor: Host.
- Precondicion: estar en pantalla de inicio.
- Resultado: sala creada con codigo unico y lobby visible.

### UC-02: Unirse a sala
- Actor: Jugador.
- Precondicion: disponer de codigo de sala valido.
- Resultado: jugador agregado al lobby.

### UC-03: Iniciar partida
- Actor: Host.
- Precondicion: sala en estado lobby.
- Resultado: primera pregunta enviada a todos.

### UC-04: Responder pregunta
- Actor: Jugador.
- Precondicion: ronda activa.
- Resultado: respuesta registrada una sola vez por ronda.

### UC-05: Consultar ranking final
- Actor: Host y jugadores.
- Precondicion: ultima ronda finalizada.
- Resultado: clasificacion final visible para todos.

## 7. Validaciones funcionales
- Nombre vacio: no permitido.
- Codigo invalido: se informa error de union.
- Accion fuera de rol: se rechaza (ej. jugador intentando iniciar).
- Sala no disponible o cerrada: se notifica.

## 8. Experiencia multiplataforma
- Compatible con movil, tablet y navegador en TV Android.
- Interfaz responsive con botones grandes para uso tactil.
- Entrada a sala simplificada por QR para dispositivos secundarios.

## 9. Criterios de aceptacion de negocio
1. Se pueden unir varios jugadores a la misma sala en tiempo real.
2. La partida progresa sincronizada para todos los clientes.
3. El sistema soporta base de preguntas >= 1000 items.
4. Se muestra ranking por ronda y ranking final.
5. El acceso por QR/URL funciona desde red local.

## 10. Futuras mejoras funcionales
1. Modos de juego (blitz, equipos, eliminacion).
2. Configuracion de numero de rondas y tiempo por pregunta.
3. Categorias seleccionables por host.
4. Revancha inmediata en misma sala.
5. Perfil de jugador e historico de puntuaciones.
