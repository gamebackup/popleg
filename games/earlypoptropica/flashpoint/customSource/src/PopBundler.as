package {
	import com.adobe.serialization.json.JSONDecoder;
	import com.adobe.serialization.json.JSONEncoder;
	import flash.net.ObjectEncoding;
	import flash.net.SharedObject;
	import flash.utils.ByteArray;

	public class PopBundler {
		private static const TYPE_JSON:String = "json";
		private static const TYPE_BYTES:String = "byte";
		private static const VERSION:int = 0;

		public const data:Object = { };
		public const ignoredObjects:Array = [ ];

		public function PopBundler(saveFiles:Array = null) {
			if(saveFiles !== null) {
				for(var i:uint = 0, lso:SharedObject; i < saveFiles.length; i++)
					addFile(saveFiles[i]);
			}
		}

		public function addFile(name:String) : void {
			const lso:SharedObject = PopUtils.getLSO(name),
				  ignoredIndex:int = ignoredObjects.indexOf(name);

			if(lso !== null && lso.size > 0) {
				data[name] = lso.data;

				if(ignoredIndex !== -1)
					ignoredObjects.removeAt(ignoredIndex);
			} else if(ignoredIndex !== -1)
				ignoredObjects.push(name);
		}

		public function removeFile(name:String) : void {
			const ignoredIndex:int = ignoredObjects.indexOf(name);

			if(data[name] is Object)
				delete data[name];

			if(ignoredIndex !== -1)
				ignoredObjects.removeAt(ignoredIndex);
		}

		public function toSharedObjects() : void {
			for(var key:String in data) {
				const lso:SharedObject = PopUtils.getLSO(key);

				if(lso !== null) {
					lso.clear();

					for(var bundleKey:String in data[key])
						lso.data[bundleKey] = data[key][bundleKey];

					lso.flush();
				}
			}
		}

		public function serialize() : ByteArray {
			const bytes:ByteArray = new ByteArray(),
			      fullObj:Object = { };

			for(var key:String in data)
				if(data[key] is Object)
					fullObj[key] = { data: data[key] };

			bytes.objectEncoding = ObjectEncoding.AMF0;
			writeString(bytes, String(VERSION));

			var json:String = null;

			try {
				json = new JSONEncoder(fullObj).getString();
			} catch(err:*) { }

			if(json === null) {
				writeString(bytes, TYPE_BYTES);
				bytes.writeObject(fullObj);
			} else {
				writeString(bytes, TYPE_JSON);
				bytes.writeUTFBytes(json);
			}

			return bytes;
		}

		public static function deserialize(bytes:ByteArray) : PopBundler {
			bytes.objectEncoding = ObjectEncoding.AMF0;
			const version:int = parseInt(readString(bytes)),
				  error:TypeError = new TypeError("Invalid file.");

			if(version !== VERSION)
				throw new TypeError("Invalid version.");

			const type:String = readString(bytes);
			var data:*;

			switch(type) {
				case TYPE_JSON:
					data = new JSONDecoder(readString(bytes), false).getValue();
					break;
				case TYPE_BYTES:
					data = bytes.readObject();
					break;
				default:
					throw new TypeError("Invalid data format.");
			}

			if(isStrictObject(data)) {
				const bundler:PopBundler = new PopBundler();

				for(var key:String in data)
					if(data[key] is Object && isStrictObject(data[key].data))
						bundler.data[key] = data[key].data;

				return bundler;
			}

			throw new TypeError("The file was decoded, but it was not an object.");
		}

		public static function createFromData(data:Object) : PopBundler {
			const bundler:PopBundler = new PopBundler();

			for(var key:String in data) {
				if(data[key] is Object && isStrictObject(data[key]))
					bundler.data[key] = data[key];
			}

			return bundler;
		}

		private static function readString(bytes:ByteArray) : String {
			for(var i:uint = bytes.position; i < bytes.length; i++)
				if(bytes[i] === 10) {
					const str:String = bytes.readUTFBytes(i - bytes.position);
					bytes.position++;
					return str;
				}
			return bytes.readUTFBytes(bytes.length - bytes.position);
		}

		private static function writeString(bytes:ByteArray, str:String) : void {
			if(str.indexOf("\n") !== -1)
				throw new SyntaxError("Bad string.");

			bytes.writeUTFBytes(str);
			bytes.writeByte(10);
		}

		private static function isStrictObject(data:*) : Boolean {
			for(var key:* in data)
				if(!(key is String))
					return false;

			return true;
		}
	}
}