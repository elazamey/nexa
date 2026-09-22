/**
 * NEXA Edge RAG — Reflection Engine
 * 
 * Post-Retrieval Reflection & Self-Evaluation Engine.
 * Analyzes factual grounding, eliminates hallucinations, and extracts lessons learned.
 */

export class ReflectionEngine {
  /**
   * Tokenize and normalize text into meaningful content words.
   */
  static extractKeywords(text) {
    if (!text || typeof text !== 'string') return new Set();
    const words = text
      .toLowerCase()
      .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return new Set(words);
  }

  /**
   * Evaluate generated answer against retrieved context chunks and user query.
   */
  static evaluate({ query = '', contextChunks = [], answer = '' }) {
    if (!answer) {
      return {
        reflectionScore: 0.0,
        contextOverlap: 0.0,
        hallucinationRisk: 1.0,
        verdict: 'UNGROUNDED',
        explanation: 'Empty or missing answer.',
        lessonLearned: 'Ensure response generation completed successfully.',
      };
    }

    const queryWords = ReflectionEngine.extractKeywords(query);
    const combinedContext = contextChunks.map((c) => (typeof c === 'string' ? c : c.text || '')).join(' ');
    const contextWords = ReflectionEngine.extractKeywords(combinedContext);
    const answerWords = ReflectionEngine.extractKeywords(answer);

    if (answerWords.size === 0) {
      return {
        reflectionScore: 1.0,
        contextOverlap: 1.0,
        hallucinationRisk: 0.0,
        verdict: 'GROUNDED',
        explanation: 'Minimal response without complex claims.',
        lessonLearned: null,
      };
    }

    // Measure overlap with context + query
    let supportedCount = 0;
    let queryOverlapCount = 0;

    for (const word of answerWords) {
      if (contextWords.has(word)) {
        supportedCount++;
      } else if (queryWords.has(word)) {
        queryOverlapCount++;
      }
    }

    const totalAnswerWords = answerWords.size;
    const contextOverlap = Number((supportedCount / totalAnswerWords).toFixed(3));
    const queryOverlap = Number((queryOverlapCount / totalAnswerWords).toFixed(3));

    // Calculate Grounding & Reflection Score
    // If context was provided, grounding is heavily weighted by context overlap.
    let reflectionScore = 0.5;
    if (contextWords.size > 0) {
      reflectionScore = Number((contextOverlap * 0.75 + queryOverlap * 0.25).toFixed(3));
      // Boost if answer is reasonably well-supported
      if (contextOverlap >= 0.4) {
        reflectionScore = Math.min(1.0, Number((reflectionScore + 0.2).toFixed(3)));
      }
    } else {
      // Direct answering without RAG context
      reflectionScore = Number(Math.min(1.0, queryOverlap * 0.5 + 0.5).toFixed(3));
    }

    const hallucinationRisk = Number((1.0 - reflectionScore).toFixed(3));

    let verdict = 'GROUNDED';
    let lessonLearned = null;

    if (reflectionScore >= 0.65) {
      verdict = 'GROUNDED';
    } else if (reflectionScore >= 0.35) {
      verdict = 'PARTIALLY_GROUNDED';
      lessonLearned = 'Answer contains peripheral terms not directly found in retrieved chunks; consider tightening context retrieval.';
    } else {
      verdict = 'UNGROUNDED';
      lessonLearned = 'Low grounding score detected; verify if query requires additional source documents or reranking.';
    }

    return {
      reflectionScore,
      contextOverlap,
      hallucinationRisk,
      verdict,
      supportedTermsCount: supportedCount,
      totalTermsCount: totalAnswerWords,
      lessonLearned,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
