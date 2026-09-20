/** Fixed host-owned program. No user text is interpolated into executable DSL. */
const instruments = ['planner', 'checker', 'ranker'];
export const ADVISORY_PROGRAM = `nexa omega 1
policy advisory {
 allow planner.call, checker.call, ranker.call, memory.store("working"), world.read("advisory_context")
 max_runtime 5s
 max_steps 16
}
${instruments.map(name => `instrument ${name} {
 resource "tool:advisory-${name}"
 actions call
 trust verified
}`).join('\n')}
agent adviser {
 role verification
 model provider.auto
 allow planner.call, checker.call, ranker.call, memory.store("working"), world.read("advisory_context")
}
${instruments.map(name => `grant ${name}.call {
 subject adviser
 ttl 1m
 max_calls 1
}`).join('\n')}
grant memory.store {
 subject adviser
 scope "working"
 ttl 1m
 max_calls 1
}
grant world.read {
 subject adviser
 scope "advisory_context"
 ttl 1m
 max_calls 1
}
mission advise {
 goal "Assess supplied candidate data; never apply a patch or run a command"
 agent adviser
 plan { observe propose assess rank remember }
 observe advisory_context
 let proposed: UntrustedData = planner.call()
 let checked: UntrustedData = checker.call()
 let ranked: UntrustedData = ranker.call()
 remember ranked as working
 emit ranked
}`;
