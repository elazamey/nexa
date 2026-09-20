/** Pure metadata retrieval and deterministic guidance; never fetches or runs a skill. */
import { requireCondition as check } from '../../learning/src/data.js';
import { hash, validateRequest } from './contracts.js';
import { LIBRARY } from './library-data.js';
const libraryHash = hash(LIBRARY);
export function libraryStatus() {
  return { version: LIBRARY.version, libraryHash, papers: LIBRARY.papers.length, skills: LIBRARY.skills.length, status: 'CURATED_GUIDANCE_ONLY', executionAllowed: false };
}
export function researchLibrary() { return { ...structuredClone(LIBRARY), libraryHash }; }
export function skillLibrary(id = null) {
  check(id === null || typeof id === 'string' && /^SK\d{2}$/.test(id), 'INVALID_SKILL_ID');
  const skills = id === null ? LIBRARY.skills : LIBRARY.skills.filter(s => s.id === id);
  check(skills.length > 0, 'UNKNOWN_SKILL');
  const ids = new Set(skills.flatMap(s => s.paperIds));
  return { ...libraryStatus(), cards: structuredClone(skills), references: structuredClone(LIBRARY.papers.filter(p => ids.has(p.id))) };
}
export function recommendSkills(request, options = {}) {
  check(options && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).every(k => ['modelLoaded', 'learningConnected'].includes(k) && typeof options[k] === 'boolean'), 'INVALID_GUIDANCE_OPTIONS');
  const { modelLoaded = false, learningConnected = false } = options;
  const { input, reports } = validateRequest(request);
  const selected = new Set(); const cited = new Set();
  const plans = input.plans.map(plan => {
    const matches = [];
    const add = (skillId, reason) => { matches.push({ skillId, reason }); selected.add(skillId); };
    const report = reports.get(plan.id);
    add('SK01', report ? 'IMPORTED_REPORT_IS_NOT_ATTESTATION' : 'MISSING_TEST_REPORT');
    add('SK02', 'BOUNDED_REPAIR_REVIEW');
    add('SK03', 'UNTRUSTED_SOURCE_CONTENT');
    if (report && (report.exitCode !== 0 || report.counts.tests !== plan.expectedTests || report.counts.pass !== report.counts.tests)) add('SK04', 'REPORTED_CHECKS_NOT_MET');
    if (plan.features.testFilesChanged) add('SK05', 'DECLARED_TEST_CHANGES');
    if (plan.features.touchesSecurityBoundary || plan.features.dependencyChanges) add('SK06', 'DECLARED_SECURITY_OR_DEPENDENCY_CHANGES');
    if (plan.features.touchesSecurityBoundary) add('SK07', 'DURABILITY_REVIEW_IF_APPLICABLE');
    add('SK08', learningConnected ? 'EXPLICIT_LEARNING_DATA' : 'LEARNING_NOT_CONNECTED');
    if (modelLoaded) add('SK09', 'EXPLICIT_CANDIDATE_MODEL');
    add('SK10', modelLoaded ? 'UNCALIBRATED_CANDIDATE' : 'NO_MODEL');
    const resolvedResearch = []; const unresolvedResearchIds = [];
    for (const id of plan.researchIds) {
      const paper = LIBRARY.papers.find(p => p.arxivId !== null && (id === p.arxivId || id === p.arxivId + p.sourceVersion));
      if (paper) { cited.add(paper.id); resolvedResearch.push({ requestedId: id, paperId: paper.id, reviewedVersion: paper.sourceVersion, trust: 'REFERENCE_NOT_ENDORSEMENT' }); }
      else unresolvedResearchIds.push(id); // Including unreviewed versions: never silently substitute or fetch.
    }
    return { planId: plan.id, matches, resolvedResearch, unresolvedResearchIds, executionAllowed: false };
  });
  const cards = LIBRARY.skills.filter(s => selected.has(s.id));
  for (const card of cards) for (const id of card.paperIds) cited.add(id);
  return {
    ...libraryStatus(), selection: 'DETERMINISTIC_RULES_NOT_LLM_OR_SEMANTIC_SEARCH',
    inputTrust: 'DECLARED_FEATURES_AND_IMPORTED_REPORTS_NOT_CODE_INSPECTION',
    context: { modelLoaded, learningConnected, trust: 'CALLER_SUPPLIED_CONTEXT_NOT_ATTESTATION' },
    automaticIngestion: false, automaticTraining: false, authority: 'none',
    plans, cards: structuredClone(cards), references: structuredClone(LIBRARY.papers.filter(p => cited.has(p.id))),
  };
}
