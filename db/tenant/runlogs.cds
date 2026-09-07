namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Controls } from './controls';
using { xyra.tenant.Systems }  from './sap';
using { xyra.tenant.Alerts }   from './alerts';

// One row per log line emitted during a control run — backs both the
// AutomationMonitoring "Logs" dialog (by control) and the AlertItem "Logs"
// dialog (by alert). `system` stays null for run-level lines (e.g. "Starting
// run"); `alert` stays null for log lines from a system that passed cleanly
// (no Alert was created for it).
entity ControlRunLogs : cuid, managed {
    control : Association to Controls not null;
    system  : Association to Systems;
    alert   : Association to Alerts;
    level   : String(10) default 'INFO'; // INFO, WARNING, ERROR
    message : String(500) not null;
}
