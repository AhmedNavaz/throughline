import { captureReview, fixPrompt, listReviewChanges, publicReview, reviewAgents, reviewFreshness, reviewLimits } from './agent-review.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export function createReviewRoutes({ registry, body, json }) {
  return async ({ req, res, url }) => {
    if (url.pathname !== '/api/reviews' && !url.pathname.startsWith('/api/reviews/')) return false;
    const projectId = url.searchParams.get('projectId');
    if (!projectId) fail('Select a workspace first.');
    let project = registry.get(projectId);
    let broker = registry.broker(projectId), c = broker.get(registry.mainConversation(projectId).id), agents = reviewAgents(c);
    const selected = () => { const id = url.pathname.match(/^\/api\/reviews\/([a-f0-9-]{36})(?:\/prepare-fix)?$/)?.[1]; const review = c.reviews.find(item => item.id === id); if (!review) fail('Review not found in this workspace.', 404); return review; };
    if (req.method === 'GET' && url.pathname === '/api/reviews') {
      json(res, 200, { ...agents, reviewerModel: c.models[agents.reviewer] || null, limits: reviewLimits, goal: (c.context.goal || c.messages.filter(message => message.role === 'user' && !message.reviewId).at(-1)?.text || '').slice(0, 4000), repositories: listReviewChanges(project.folders), reviews: c.reviews.map((review, index) => ({ ...publicReview(review), ...(index === 0 ? reviewFreshness(review, project.folders) : {}) })) }); return true;
    }
    if (req.method === 'GET') { const review = selected(); json(res, 200, { ...review, ...reviewFreshness(review, project.folders) }); return true; }
    if (req.method !== 'POST') fail('Use POST to preview or start a review.', 405);
    const input = await body(req, 32000);
    project = registry.get(projectId);
    // Folder membership can change while a request body arrives; use the current broker and roots.
    broker = registry.broker(projectId); c = broker.get(registry.mainConversation(projectId).id); agents = reviewAgents(c);
    if (url.pathname === '/api/reviews/preview') {
      if (broker.running) fail('Wait for the current run to finish before preparing a review.', 409);
      json(res, 200, { ...agents, snapshot: captureReview(project.folders, input.files) }); return true;
    }
    if (url.pathname === '/api/reviews/start') {
      if (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 4000) fail('Describe the goal in at most 4,000 characters.');
      if (typeof input.approvedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.approvedDigest)) fail('Preview the selected changes before starting.');
      const snapshot = captureReview(project.folders, input.files);
      if (snapshot.digest !== input.approvedDigest) fail('The selected changes have changed. Preview them again.', 409);
      const review = { snapshot, goal: input.goal.trim(), builder: agents.builder, ...(agents.builderConnection ? { builderConnection: agents.builderConnection, builderModel: agents.builderModel } : {}), provider: agents.reviewer, model: c.models[agents.reviewer] || null };
      const result = broker.start(c, { text: `Review selected changes: ${review.goal}`, provider: agents.reviewer, model: review.model, mode: 'read', requestId: input.requestId, billingConfirmed: input.billingConfirmed === true }, { review, verifyReview: () => {
        if (captureReview(registry.get(projectId).folders, input.files).digest !== input.approvedDigest) fail('The selected changes have changed. Preview them again.', 409);
      } });
      json(res, 202, { ...result, reviewId: result.runId }); return true;
    }
    if (url.pathname.endsWith('/prepare-fix')) {
      const review = selected();
      if (broker.running) fail('Wait for the current run to finish before preparing fixes.', 409);
      if (reviewFreshness(review, project.folders).stale) fail('This review is outdated. Run a new review before preparing fixes.', 409);
      json(res, 200, { provider: review.builder, text: fixPrompt(review, input.findingIds) }); return true;
    }
    fail('Review operation not found.', 404);
  };
}
