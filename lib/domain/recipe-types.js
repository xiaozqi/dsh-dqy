// Declarative platform recipe. A recipe describes only the UI path for one
// platform (open -> conversation -> input -> send -> verify); the watch
// pipeline, guard and state machine stay generic and are shared by every
// platform. Adding a new app means adding one YAML file, not core code.
export {};
