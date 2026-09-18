/**
 * Offline fixtures: a local RSA key pair, a local JWKS, and a token signer.
 *
 * G0 proves the whole identity contract **with no network**: CI signs its own tokens with the
 * keys below and verifies them against a JWKS built from the same material. Nothing here is
 * Google material — these are throwaway test keys with a known private half, and they are the
 * reason the suite is reproducible rather than dependent on a live provider.
 *
 * Three keys exist on purpose. `offline-key-1` is the identity the fixture JWKS trusts;
 * `offline-key-2` is a second key the provider may publish, which is how "one refresh, then
 * refuse" is tested against a real refresh rather than a mocked `undefined`; `offline-key-3`
 * is never published by anyone, and exists so a forgery can be signed *by a real RSA key* that
 * the trusted source does not list — a lookalike signing key, not a corrupted signature.
 *
 *   node --test tests/google-*.test.js
 */
import { createSign, createPrivateKey } from 'node:crypto';

/** The client id these tokens are minted for. A configured value, never a default. */
export const OFFLINE_CLIENT_ID = 'nexa-offline-client.apps.googleusercontent.com';

/** The issuer the pinned `gsi` source accepts. */
export const OFFLINE_ISSUER = 'https://accounts.google.com';

/** The clock every offline suite runs on. */
export const OFFLINE_T0 = new Date('2026-09-18T12:00:00Z');

const PEM = {
  'offline-key-3': `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC2NwSWncnwdPjk\nQpJRYDcWrGROEHjUSyZYbiK9qEVvLZYJZzFG0BLjI98wRF9E+UtuytwPxipQty2y\nGBqMrjwxMyXvuiS54Wp4mvorMdTq8Es+cderNWP6appEaV28vREJAPCSg+q2H4G7\ncw55mt18AfwGjrBqEPqpNaPf2NKyypDwwysMg3uAXf4aKS/kIeJY0VDFMrEYXBYJ\nuBGZtDmXX6ZJnBkagtzzY9MjUrfLR+vHcXCyK1+ouDITYhrooNsd3lKMFXsTaftb\nx0ZK+RNQWwYbrE2WesPwuGpLyFNwAZ0K8TAy64+PQkYG8Meg1iamy3nfyIUxJ39e\nAB3QlTnbAgMBAAECggEABZm7+V57hiQs648kQii2k2rUYRXehjU9G3tfHqcyYyVq\njCVw0qAImen7V9dyJNjouaILO4I4FhJbRDMQyywmdiNVUitNf60ZrFVPGnlwoDv8\nhBHUXX3JnI50Prq3rS++e0wHw5PBvhFKgoFvJiEIF7dT5hEIA7/mhGw9T4mxiC87\noXxk6fpV4dMWDIiBUxJILZhqmqgtHkCh304mtbjEV7jiVUCZJ5onVVSBMwj5uw+g\nnb/znMS1Hhq/zgu7Zv7+O8LbliiHrsTr5F1N/ZuvS84jQ109c1jnwey2MoamSkR1\nRBlE4nRVgPF2CfKauTuVYVCfpCmFkQ03V5m04gmiqQKBgQD4iEl2O5T2tk83i36u\nEGoJEfp7Cgj8uIVXLrYxWjr6WKL11tIq2ZJ23ctmhYSdhdlwY2lDnOjS3YNyJPNU\nji1uUcAP+n9AuiolIQ4oAfuB0Ck13cqNy525PONH/RTuscloYEmbBNFoYzmiIQvG\n7De92eVLp2VdKQPq7DF0ILUZVwKBgQC7sJ3VY28Q5+1+i8y2U4kBfq7RnNEGYIxh\n6zq5q9zKxOoYbrA0+XnKVq+Hk1G2SixPPiwC96ZfMVFmECC6Osw7LdaUdFdsd+2c\nXhI/VuJtAZnZM4YOg1oKuV1mhixn43JCk18k3k4CvzUfrF5Uel929moazYbnJLgj\nsogm0VGdHQKBgB40iiEZerBFVfldNcc37XsuuS+M96ynTGVdIv16huJ4NU4FjsNw\nb/GMYTUTkxuF8fhLzLZP8qf2DgyoWv5yzSi0PNB0VFTsi0S58LuCCiwrvWZzjzOO\nhJvHv6O3KX0dFGpgEXIKstyp+o4uz/ycJuYm/kwkixg4bOZ3UEdZ1ki/AoGANMaI\n2wPGqz5L7ZVpzqrWj3ELvy0VKXHkh3QZYzQMNYgBOzWEnqC3ukl9ueWWyGc65l1Z\nCsyQH5xCgyxtx2/ZFZriB4RfQMTIL3vULbNEn9ofZI+0Vkhg/Tr6JGX9/ohaDJZb\n3oYT8XnKekmBjMeMKGtJkpfQIxaUIJWG60NYa5ECgYEAtlSpuV1ggU+L/4+5p2rn\nI61noX+BEYMvYAfIfa035zwg4B930uigsAyD5XJ3M0CpiOTmCijYTcGwDguBMNcC\n0jx8dNVas4m0cLmJmSmY+JtoeJCtdnxShmPxusc1D8As3S3o06QRxUak/Ma7YNHl\nY+YDpJF5ASDYj+6uf/y8AC8=\n-----END PRIVATE KEY-----\n`,
  'offline-key-1': `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDOn/if/876u8ck\nfRzEgXKKnUb5oWw37EkS7Fv+2TdujGrs5e1sx7uxs9Cw4iY6wvbjwaV28olhxiBt\ntDmKasCuTb6vCKFO5bRUJPS7vjrgPdkQaR0aLp2hHiGWPyE4N88ndQ/m4FjKY0Da\njz6QWGljR4xsx2SAMge5DV0B8HzBsFL1gKewqNhvOqo33pd5GgwkIOhjPYE6OES5\nF4Q0LXyq1aRxu80+yJkVJ3K6bNU+VmfWoJ/etpIFhd9FaJVgUlUjrwIQAcQ1KzU0\nIhUipi0KIWbRda6JvEX0q5b1dIhDALPq/32/tcLR2a4phWQyck61C9QjHMovYlrq\nBT9e0v8PAgMBAAECggEADUxqehHCxoxzYrvSsCsMrjM1MDfdeTPx+A/SU/KzCKBs\n+VZLE6c/Q06pbdkAUOPfdAUwmxk9ElfoGmdxFKGOSSmjziwmBafvFUNTpQm3TFtu\nrwm038yERKxlyP/DKZUd9hIotdlWnaAJuodhpXSrQ8KFHTMwGrgdmyFrDQbnYKfU\n7YCIFm5t8viPPNLs73ZAsWVsNc5n13tNn17P+2rWC91QR0eX4F/5jz99ki6GZiKj\nPcuFvppmyc69Ej4emZJWlWh170TOx+wCm4Zu8vQ946ZiCmLWfdKVm6FCsp8Huzba\n5vtJ1wB5DXZR711G+H/piVpwePtz9+/DmNBmy5scQQKBgQDvzaiK5b8/kPrAaLFI\n2B56FqJG9TxaQBb5N5W1lSzixIB92j7KCVqDOi9gLN4fh/WaXkFPVloGTv3r0R3g\nJL4Iz1cUHwjoIQ9jzw+IV6d8F6GZmM3M6FYwA+pqSx07CYjFKkeXXLAR4mBgou33\n7GyGZ2R4mgKM8j31Zw1N8u3dsQKBgQDclKM2teGvHjA991hpy6NQhsAzvrAWt+fv\nNncLDoFNJGYiyvaR1mUbXWTIhz1Y0CuNeWsd6F4pItW0hHwug78EHv4F/epKX3DB\nR2Q2hpVHOlekY7GpBnJhTqdMt9TKuKTWfF4GiT1ILz0h98ULDtxESBJO00XhRDLe\nnke3ZjIYvwKBgFvcS1ER22YtUnD8adU+vMYF/5nw/XKRFHvZWCccAvrHTXVoch8Q\n4DReyKEt7tTjTykYLCqJKKk7/zcjfy9Kw+U6D+BsVwwdBfk0631OHqGBp+zfxQ5W\nfhWcmmKnbYYdC+CDZrNL1UK0ljjOkRwk3BnMZ4dvb8SwUx27oTQX+BixAoGANUeZ\n3N818iyijnUuX++WNR83UchflD07wqYvPvZz+QQvv3uy7ysQJPn8HAu+n7M4seWA\nICs+g0UsxXuy2zFrdD1gMmZQr0I6ZBUweZMsf5XyEX0bLq6l9icfdgJ5XbYX6s8D\njySbLtJqO8gzSiZ+wed+tJeHq4/jka49uGjw9NUCgYEAjtOdfY/XLz/l43AlCHnd\nc832m0C4xoCi5jU7SLxVCu2uK4uPmmOmVf0iyyplx52AoyFmF/f2N1MBq6Hrhmt7\nUBJlEVlqMed9LQxPGeyTdhdjcVB5ieBGeDXtv8ptxUMoQErJbZ2zDC5uuXhMVWJQ\nDI1uqzOQsS6+0g77x7X7a24=\n-----END PRIVATE KEY-----\n`,
  'offline-key-2': `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQClguY5tZoqwDjd\nVYeV13j8pFuY/CYS8QyFNuvc4HSM6fXKXy+N6RgrL5pOH8XXUj3EjXKl8mxJTrIE\nLfZcJO2iSk5VNVDEyD1RDmj0iEJ4I6zCD7SDg5uStkvoUTFGdV6jVkrXLTP0MoEk\nD5MEC8yYH7Fyvkw1xZvzJYbUIPOvMRkJp6OTVkMRf+hkKmOykqrP1EPNcAT67YD5\n2H17qdsoQATIZ1Yb2FMl0STC0T3vOmXfN276RW1/LyIQuc6W0mkWxYyqopx82QtG\nTcvHDqxpxd9ZiJPyWlNjLyVc4PKsocZtU9uQSvzrwGIOaW5nb94Fn+3UUOn6tMDF\n06kaucWHAgMBAAECggEAFJdIan2RWdLi6tutK+h2q4JhyD1LxKeAgJeTQxNu7JO0\nJHfbGV3vx8+lns/ic9Cje+8tCEA0q0TDGN9ZpZ+31gJF5Ivm1H8k7GSijL7hphiq\nHCqKsUyPmkexAeINWKVZdMX+Nu7vZmiyGvkPt+fP4vfDwnFdAdjnzJl/61F+KkP6\nEgDIDVyIx7lqkMfQXjZu+EVtsU2y2vQd3gGbJI2AMNJsTIOHUeqrQnC79YoJRz5N\n1e+C6s9ovjXA1udN5o90Io3qOQswUDWr4sPm3jaYXDGYgQx/9HO1tb0snW9jDzeL\nsd+Wp6x4aJG0zf8eRPh7UNjfzL5anKbN9pGLo6O1gQKBgQDeywps1nWbMPgdFCgs\nLYbPIV4kKgWYUhPSEx6N2xdnRVH8yhu4n4CX8MU0wmC+waq+kBcKgTaQ0BdDCHrL\nH/lxEsqcNN6ii26gs+nnKme9sWtgXOiF1Em9LH1nzSUroTNp67wLGi6w+7AzMa0/\nFD5CZzgMRbGncrmZ1Ue459x8FwKBgQC+LjKQF7RhPnJfG6/1moS5mk/sb7DLFbrN\nsEcGP/iUAdPJ+99muUbH+5vqx/GZ+QjbzKKa/bHaijdXVFnSwmlxBiJ6BE+XyktE\nKyja3/c7KRMNvqJzpngXUcYN8VGtjSDnnlWcPOjXxgx/ax4uRoxRmlbHt8pxMv52\nBR4PGWO4EQKBgBuRCegvnPun0ntenB3jQDPu0AQvguO2/CbZIMWynzGy/RMHOujc\nK4AhVXVSu7++nM7Za1BsboD6jnZH3VG20hlwlss/K3D3SafuuvlUYOOyyTNyK38r\npjgXAilO09OTLZZkia7h/Xb+nW2oLuSIL6/tr5ytHu82Hcrv/eDeJ4TfAoGBAIt2\n3WWFvKXDYaQVbcgydDqXyxycG44SdVb5elw+9U+0t1db+cwe+qUVApX94lMDqVdm\njagTeyXETikglm5UW3ajBQ1ts+CgXOm0rNU1gNxFls9xiTg+T7rqIM+AtGENKaAx\nIJ7em/IALpISP6O34JbHE/SJ909kEe8CebSg7dvBAoGAM/M0mjjqeo3IrcflS9u4\naXqCCnXdldk4eZ5QEHSClxFCuorjhOxe8Io5AphgNK+fgB1uaZavKcdjJ+Sbzifx\n6UDdNOcnPSnV6BdG2NiH/LpPHidIsRTz3YbckMKvD0yUjw0go4bjgYUVbMQ+6Ib6\nmkoghTLwWPAIiMs+pAnoT+o=\n-----END PRIVATE KEY-----\n`,
};

const PUBLIC = {
  'offline-key-1': { n: 'zp_4n__O-rvHJH0cxIFyip1G-aFsN-xJEuxb_tk3boxq7OXtbMe7sbPQsOImOsL248GldvKJYcYgbbQ5imrArk2-rwihTuW0VCT0u7464D3ZEGkdGi6doR4hlj8hODfPJ3UP5uBYymNA2o8-kFhpY0eMbMdkgDIHuQ1dAfB8wbBS9YCnsKjYbzqqN96XeRoMJCDoYz2BOjhEuReENC18qtWkcbvNPsiZFSdyumzVPlZn1qCf3raSBYXfRWiVYFJVI68CEAHENSs1NCIVIqYtCiFm0XWuibxF9KuW9XSIQwCz6v99v7XC0dmuKYVkMnJOtQvUIxzKL2Ja6gU_XtL_Dw', e: 'AQAB' },
  'offline-key-2': { n: 'pYLmObWaKsA43VWHldd4_KRbmPwmEvEMhTbr3OB0jOn1yl8vjekYKy-aTh_F11I9xI1ypfJsSU6yBC32XCTtokpOVTVQxMg9UQ5o9IhCeCOswg-0g4ObkrZL6FExRnVeo1ZK1y0z9DKBJA-TBAvMmB-xcr5MNcWb8yWG1CDzrzEZCaejk1ZDEX_oZCpjspKqz9RDzXAE-u2A-dh9e6nbKEAEyGdWG9hTJdEkwtE97zpl3zdu-kVtfy8iELnOltJpFsWMqqKcfNkLRk3Lxw6sacXfWYiT8lpTYy8lXODyrKHGbVPbkEr868BiDmluZ2_eBZ_t1FDp-rTAxdOpGrnFhw', e: 'AQAB' },
  'offline-key-3': { n: 'tjcElp3J8HT45EKSUWA3FqxkThB41EsmWG4ivahFby2WCWcxRtAS4yPfMERfRPlLbsrcD8YqULctshgajK48MTMl77okueFqeJr6KzHU6vBLPnHXqzVj-mqaRGldvL0RCQDwkoPqth-Bu3MOeZrdfAH8Bo6wahD6qTWj39jSssqQ8MMrDIN7gF3-Gikv5CHiWNFQxTKxGFwWCbgRmbQ5l1-mSZwZGoLc82PTI1K3y0frx3FwsitfqLgyE2Ia6KDbHd5SjBV7E2n7W8dGSvkTUFsGG6xNlnrD8LhqS8hTcAGdCvEwMuuPj0JGBvDHoNYmpst538iFMSd_XgAd0JU52w', e: 'AQAB' },
};

/** @param {string} kid @returns {{kty: string, kid: string, n: string, e: string, alg: string, use: string}} */
export function offlineJwk(kid = 'offline-key-1') {
  const publicPart = PUBLIC[kid];
  if (publicPart === undefined) throw new Error(`no offline key named ${kid}`);
  return { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: publicPart.n, e: publicPart.e };
}

/** @param {string[]} [kids] @returns {{keys: object[]}} a JWKS, in the provider's shape */
export function offlineJwks(kids = ['offline-key-1', 'offline-key-2']) {
  return { keys: kids.map((kid) => offlineJwk(kid)) };
}

/** @param {string} kid @returns {import('node:crypto').KeyObject} */
function privateKeyFor(kid) {
  const pem = PEM[kid];
  if (pem === undefined) throw new Error(`no offline private key named ${kid}`);
  return createPrivateKey(pem);
}

/** @param {object} claims @param {string} [kid] @returns {string} a signed JWS, base64url JSON */
export function signOfflineToken(claims, { kid = 'offline-key-1', header = {} } = {}) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid, ...header }), 'utf8').toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyFor(kid)).toString('base64url');
  return `${signingInput}.${signature}`;
}

/**
 * A valid claim set. Every offline suite starts from this and changes exactly one thing, so a
 * refusal can only be attributed to the change.
 * @param {object} [overrides]
 * @returns {object}
 */
export function offlineClaims(overrides = {}) {
  const issuedAt = Math.floor(OFFLINE_T0.getTime() / 1000);
  return {
    iss: OFFLINE_ISSUER,
    aud: OFFLINE_CLIENT_ID,
    azp: OFFLINE_CLIENT_ID,
    sub: '110169484474386276334',
    email: 'canyoudfg@gmail.com',
    email_verified: true,
    iat: issuedAt,
    exp: issuedAt + 3_600,
    ...overrides,
  };
}

/** @param {string} token @returns {string} the same token with a corrupted signature */
export function corruptSignature(token) {
  const parts = token.split('.');
  const flipped = parts[2].endsWith('A') ? 'B' : 'A';
  return `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${flipped}`;
}
