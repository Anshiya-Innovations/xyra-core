namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// ponytail: minimal skeleton — the real Scheduler gets its own ticket.
entity SchedulerJobs : cuid, managed {
    name           : String(100) not null;
    cronExpression : String(50);
    status         : String(20) default 'ACTIVE'; // ACTIVE, PAUSED
    lastRunAt      : Timestamp;
}
