---
title: C# signals
---

# C# signals

## Declaring and emitting signals

C# signals use a delegate marked with the Signal attribute. Connect a listener
with the generated event and notify it with EmitSignal. Unlike GDScript signals,
C# signal delegates must have names ending in EventHandler.

```csharp
using Godot;

public partial class Health : Node
{
    [Signal]
    public delegate void HealthChangedEventHandler(int value);

    public override void _Ready()
    {
        HealthChanged += value => GD.Print(value);
        EmitSignal(SignalName.HealthChanged, 80);
    }
}
```
