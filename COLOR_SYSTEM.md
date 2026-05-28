# LUCY Color System

LUCY uses calm dark surfaces with warm orange light. The look should feel quiet, human, and intelligent rather than robotic.

## Core Palette

| Role | Color | Purpose |
| --- | --- | --- |
| Background | `#0D1015` | Main dark canvas |
| Surface | `#151A21` | Navigation and subtle structure |
| Raised surface | `#1D242D` | Cards and composer |
| Primary orange | `#F97316` | Calls to action and identity |
| Glow orange | `#FB923C` | Active labels and status emphasis |
| Main text | `#F7F4EF` | Warm readable type |
| Muted text | `#A8A198` | Secondary information |

## Pillar Subtitle

Header copy:

`Listen | Understand | Connect | Yield`

In the app, pillars are separated visually by bullet marks and use restrained warm variations so orange remains the dominant signature.

## Implementation

Colors and pillar metadata live in `src/config/colors.ts`. Components should use the shared palette rather than introducing isolated green or bright-white surfaces.
