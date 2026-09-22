---
title: GDScript signals
---

# GDScript signals

## Declaring and emitting signals

GDScript signals let a node notify listeners when an event happens. Declare a
signal with the signal keyword, connect a callable, and emit it with the value
listeners need. Unlike C# events, GDScript uses the signal object's emit method.

```gdscript
extends Node

signal health_changed(value: int)

func _ready() -> void:
    health_changed.connect(_on_health_changed)
    health_changed.emit(80)

func _on_health_changed(value: int) -> void:
    print(value)
```
