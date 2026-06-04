import type { CharacterPreset } from "../renderer/types";

export const builtInCharacterPresets: CharacterPreset[] = [
  {
    id: "dense-portrait",
    name: "Dense Portrait",
    characters: "@#WMBRXVYIti+=;:.",
    builtIn: true
  },
  {
    id: "sparse-cinematic",
    name: "Sparse Cinematic",
    characters: "MWNXK0Okxdolc:,'.",
    builtIn: true
  },
  {
    id: "minimal-silhouette",
    name: "Minimal Silhouette",
    characters: "█▓▒░.",
    builtIn: true
  },
  {
    id: "fine-detail",
    name: "Fine Detail",
    characters: "@%#*+=-:.",
    builtIn: true
  },
  {
    id: "dots",
    name: "Dots",
    characters: "·•◉●",
    builtIn: true
  },
  {
    id: "blocks",
    name: "Blocks",
    characters: " ░▒▓█",
    builtIn: true
  },
  {
    id: "poster-grain",
    name: "Poster Grain",
    characters: "W@N#8R$0QXxocv!;:,. ",
    builtIn: true
  },
  {
    id: "edge-ink",
    name: "Edge Ink",
    characters: "MNHKXE\\/|1l;:'. ",
    builtIn: true
  }
];

export const defaultCharacterPreset = builtInCharacterPresets[0];
