import base from './playwright.config.mjs';
export const finalFiles = ['qc-personal-client-portals.spec.mjs', 'quotation-print-pagination.spec.mjs', 'quotation-print.spec.mjs'];
const phase = process.env.BOS_FUNCTIONAL_PHASE;
if (process.env.CI !== 'true' || !['1', '2'].includes(phase)) throw new Error('Explicit CI functional phase required');
const config = {
  ...base,
  projects: base.projects.map(project => project.name !== 'browser-journeys' ? project : {
    ...project,
    ...(phase === '1' ? { testIgnore: [project.testIgnore, ...finalFiles.map(file => `**/${file}`)] } : { testMatch: finalFiles.map(file => `**/${file}`) }),
  }),
};

export default config;
