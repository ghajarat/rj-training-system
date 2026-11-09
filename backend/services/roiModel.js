// Phase 7: the money side of Analytics & ROI.
//
// GP1's schema stores the operational KPIs (kpis: value before and after
// training per department) but no money: no training costs and no value of a
// KPI point. Those figures would come from RJ Finance. Until they do, the
// assumptions below are used. They are DEMO VALUES, kept in this one file
// and returned by the API, so the Analytics page can show exactly how ROI
// was worked out and anyone can replace them.
//
//   cost     = training hours completed × COST_PER_TRAINING_HOUR
//            + trainees in training     × PLATFORM_COST_PER_TRAINEE
//   benefit  = Σ over KPIs: units improved × value of one unit
//   ROI %    = (benefit − cost) / cost × 100
//
// Currency: Jordanian dinar (JOD).
const CURRENCY = 'JOD';

// Instructor time, content upkeep and the trainee's paid hours, per hour of
// training actually completed.
const COST_PER_TRAINING_HOUR = 30;

// Licences, hosting and AI usage for one trainee for the period.
const PLATFORM_COST_PER_TRAINEE = 45;

// Plan completion target used for Time-to-Competency (days from assignment
// to finishing every course of a plan).
const COMPETENCY_TARGET_DAYS = 45;

// Per KPI name (kpis.kpi_name): which direction is better, and what one unit
// of improvement is worth for the period. A KPI not listed here is still
// shown, but adds nothing to the benefit ("not valued").
const KPI_VALUES = {
  'Safety incidents (per quarter)':          { lowerIsBetter: true,  unitValue: 1800 },
  'Compliance audit pass rate (%)':          { lowerIsBetter: false, unitValue: 450 },
  'Customer satisfaction (CSAT %)':          { lowerIsBetter: false, unitValue: 600 },
  'On-time service delivery (%)':            { lowerIsBetter: false, unitValue: 700 },
  'Passenger complaints (per 10k pax)':      { lowerIsBetter: true,  unitValue: 900 },
  'Baggage mishandling (per 1k bags)':       { lowerIsBetter: true,  unitValue: 1100 },
  'Average turnaround delay (minutes)':      { lowerIsBetter: true,  unitValue: 650 },
};

function kpiValue(name) {
  return KPI_VALUES[name] || null;
}

module.exports = {
  CURRENCY,
  COST_PER_TRAINING_HOUR,
  PLATFORM_COST_PER_TRAINEE,
  COMPETENCY_TARGET_DAYS,
  KPI_VALUES,
  kpiValue,
};
