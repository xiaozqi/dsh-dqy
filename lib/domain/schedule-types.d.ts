export interface SchedulePlan {
    app: string;
    hour: number;
    minute: number;
    enabled: boolean;
}
export interface ScheduleTick {
    app: string;
    ranAt: string;
    status: 'success' | 'failed' | 'skipped';
    detail: string;
}
