export interface RecipeSelector {
    text?: string;
    desc?: string;
    resourceId?: string;
    className?: string;
    regex?: boolean;
}
export type RecipeStepType = 'open_app' | 'wait_for' | 'tap' | 'input' | 'send' | 'press_key' | 'verify';
export interface RecipeStep {
    action: RecipeStepType;
    selector?: RecipeSelector;
    value?: string;
    from?: string;
    key?: 'back' | 'home' | 'recents' | 'enter';
    timeoutMs?: number;
}
export interface PlatformRecipe {
    platform: string;
    packageName: string;
    displayName: string;
    steps: RecipeStep[];
}
export interface RecipeContext {
    [key: string]: string;
}
