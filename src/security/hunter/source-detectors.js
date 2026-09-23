import { detectUnhandledAsync, DETECTOR_ID as UNHANDLED_ASYNC_ID, PRODUCER as UNHANDLED_ASYNC_PRODUCER } from './detector-unhandled-async.js';
import { detectWeakCrypto, DETECTOR_ID as WEAK_CRYPTO_ID, PRODUCER as WEAK_CRYPTO_PRODUCER } from './detector-weak-crypto.js';
import { detectResourceLeak, DETECTOR_ID as RESOURCE_LEAK_ID, PRODUCER as RESOURCE_LEAK_PRODUCER } from './detector-resource-leak.js';

/**
 * D1.7 (A05 / DI-15) — قائمة التجميع الوحيدة لكواشف المصدر.
 *
 * المنسِّق يستهلك هذه القائمة ولا يعرف شيئًا عن منطق أي كاشف: إضافة كاشف = وحدة + مدخل هنا،
 * بلا سطر شرط داخل جسم الجولة. كل مدخل يسمّي مُنتِجه (يُربَط به artifact.producedBy
 * وsafeTesting.attestedBy — عقد D1.3) وأصنافه، فتُختبر كل وحدة منفردة وتُعرَف من أين خرج finding.
 */
export const SOURCE_DETECTORS = Object.freeze([
  {
    id: UNHANDLED_ASYNC_ID,
    producer: UNHANDLED_ASYNC_PRODUCER,
    types: Object.freeze(['UNHANDLED_ASYNC_ERROR']),
    detect: detectUnhandledAsync
  },
  {
    id: WEAK_CRYPTO_ID,
    producer: WEAK_CRYPTO_PRODUCER,
    types: Object.freeze(['WEAK_CRYPTOGRAPHY']),
    detect: detectWeakCrypto
  },
  {
    id: RESOURCE_LEAK_ID,
    producer: RESOURCE_LEAK_PRODUCER,
    types: Object.freeze(['POTENTIAL_RESOURCE_LEAK']),
    detect: detectResourceLeak
  }
]);
