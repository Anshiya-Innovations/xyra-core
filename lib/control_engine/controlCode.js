// deleteControl keeps Alerts as compliance history, so alert.control_ID can
// dangle (e.g. a control deleted and re-created under the same code). Fall
// back to the code runControl wrote into the alert's run summary:
// "Control XYRA-08 on S4D/100: 2 deviation(s)."
function controlCodeOf(control, alert) {
  if (control) return control.code
  const m = /^Control (\S+) on /.exec((alert && alert.description) || '')
  return m ? m[1] : ''
}

module.exports = { controlCodeOf }
