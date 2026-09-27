// A revision check prevents an older device from silently replacing newer work.
export class JournalSync {
  constructor({write, persist, apply, report}) {
    Object.assign(this, {write, persist, apply, report});
    this.revision = 0;
    this.payload = null;
    this.dirty = false;
    this.busy = false;
    this.conflict = false;
    this.closed = false;
    this.remote = null;
  }
  start(remote, draft) {
    this.remote = remote;
    this.revision = remote?.revision || 0;
    this.payload = remote?.payload || null;
    if (draft?.dirty) {
      this.payload = draft.payload;
      this.revision = draft.revision;
      this.dirty = true;
      // A tab may have closed after the server committed but before local cleanup.
      if (remote?.payload === draft.payload) {
        this.revision = remote.revision;
        this.dirty = false;
      } else if (this.revision !== (remote?.revision || 0)) this.conflict = true;
    }
    this.apply(this.payload);
    this.remember();
    this.report(this.conflict ? 'conflict' : this.dirty ? 'pending' : 'saved');
  }
  remember() {
    this.persist({payload:this.payload, revision:this.revision, dirty:this.dirty});
  }
  edit(payload) {
    if (this.closed) return;
    this.payload = payload;
    this.dirty = true;
    this.remember();
    this.report(this.conflict ? 'conflict' : 'pending');
  }
  receive(remote) {
    if (this.closed || !remote) return;
    this.remote = remote;
    if (this.busy || remote.revision <= this.revision) return;
    if (this.dirty) {
      this.conflict = true;
      this.report('conflict');
    } else {
      this.revision = remote.revision;
      this.payload = remote.payload;
      this.apply(this.payload);
      this.remember();
      this.report('saved');
    }
  }
  async flush() {
    if (this.closed || this.busy || this.conflict || !this.dirty) return;
    this.busy = true;
    const payload = this.payload, revision = this.revision;
    this.report('saving');
    try {
      const result = await this.write(payload, revision);
      if (this.closed) return;
      this.revision = result.revision;
      this.dirty = this.payload !== payload;
      this.remember();
      this.report(this.dirty ? 'pending' : 'saved');
    } catch (error) {
      if (this.closed) return;
      this.conflict = error.code === 'revision-conflict';
      this.report(this.conflict ? 'conflict' : 'error', error);
    } finally {
      this.busy = false;
      if (!this.closed && this.remote) this.receive(this.remote);
    }
  }
  useRemote(remote) {
    if (this.busy) throw new Error('저장이 끝난 후 다시 시도해 주세요.');
    this.conflict = false;
    this.dirty = false;
    this.start(remote, null);
  }
  close() { this.closed = true; }
}
