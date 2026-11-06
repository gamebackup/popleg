package  {
	public class FileHandler {
		import flash.events.Event;
		import flash.events.IOErrorEvent;
		import flash.net.FileReference;
		import flash.utils.ByteArray;

		private var callback:Function = null;
		private var reference:FileReference = new FileReference();

		public function FileHandler() { }

		public function get busy() : Boolean {
			return callback !== null;
		}

		public function download(bytes:ByteArray, filename:String, callback:Function) {
			assertUsable();
			this.callback = callback;
			reference.save(bytes, filename);
			reference.addEventListener(Event.COMPLETE, onDownloadStatus);
			reference.addEventListener(Event.CANCEL, onDownloadStatus);
			reference.addEventListener(IOErrorEvent.IO_ERROR, onDownloadStatus);
		}

		public function upload(typeFilter:Array, callback:Function) {
			assertUsable();
			this.callback = callback;
			reference.browse(typeFilter);
			reference.addEventListener(Event.SELECT, onUploadBrowseStatus);
			reference.addEventListener(Event.CANCEL, onUploadBrowseStatus);
		}

		private function assertUsable() : void {
			if(busy)
				throw new Error("The file handler is busy with another process.");
		}

		private function onDownloadStatus(event:Event) : void {
			reference.removeEventListener(Event.COMPLETE, onDownloadStatus);
			reference.removeEventListener(Event.CANCEL, onDownloadStatus);
			reference.removeEventListener(IOErrorEvent.IO_ERROR, onDownloadStatus);
			onResponse(event.type === Event.COMPLETE);
		}

		private function onUploadBrowseStatus(event:Event) : void {
			reference.removeEventListener(Event.SELECT, onUploadBrowseStatus);
			reference.removeEventListener(Event.CANCEL, onUploadBrowseStatus);

			if(event.type === Event.SELECT) {
				reference.load();
				reference.addEventListener(Event.COMPLETE, onUploadFinishStatus);
				reference.addEventListener(IOErrorEvent.IO_ERROR, onUploadFinishStatus);
			} else
				onResponse(null);
		}

		private function onUploadFinishStatus(event:Event) {
			reference.removeEventListener(Event.COMPLETE, onUploadFinishStatus);
			reference.removeEventListener(IOErrorEvent.IO_ERROR, onUploadFinishStatus);
			onResponse(event.type === Event.COMPLETE ? reference.data : null);
		}

		private function onResponse(data:*) : void {
			const cb:Function = callback;
			callback = null;
			cb(data);
		}
	}
}