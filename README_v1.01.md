# Skies & Seas: Fog of War — v1.01

A pass-and-play, Battleship-inspired web game with:
- Two layers (Sea + Air)
- Fog tokens on misses
- Recon clears fog and counts occupancy in a 3×3 area
- Air Superiority: if you have more active planes, you get 1 yes/no question per turn
- Win by sinking all ships

## Run
Open `index_v1.01.html` in Chrome (works offline).

## Controls
- Setup: click to place units
- R: rotate (ships horizontal/vertical; planes rotate 0°/90°)
- 1: Sea grid (setup)
- 2: Air grid (setup)
- End Turn: pass-and-play overlay

## Notes
Plane disable rule (simple): if all cells of a plane are hit, it's disabled for 2 of its owner's turns, then it returns and its hits clear.
