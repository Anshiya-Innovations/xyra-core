// Provider-independent DNS abstraction. Nothing outside this file should know
// or care which DNS provider is behind dnsService — swap the implementation
// here (Route53, Cloudflare, ...) without touching the provisioning workflow.
class DNSProvider {
  async createRecord(_subdomain, _target) {
    throw new Error('DNSProvider.createRecord() not implemented')
  }
}

// ponytail: no real DNS provider wired up yet — this just logs intent and returns
// a fake record so the provisioning pipeline has something to persist. Replace with
// a Route53Provider/CloudflareProvider implementing the same createRecord(subdomain,
// target) contract when a real provider is chosen.
class NoopDNSProvider extends DNSProvider {
  async createRecord(subdomain, target) {
    console.log(`[dns] createRecord: ${subdomain} -> ${target} (noop provider, no real DNS record created)`)
    return { subdomain, target, recordId: null, provider: 'noop' }
  }
}

const dnsService = new NoopDNSProvider()

module.exports = { DNSProvider, NoopDNSProvider, dnsService }
