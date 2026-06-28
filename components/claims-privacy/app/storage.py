from typing import Optional

import boto3


class R2Storage:
    def __init__(
        self,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        bucket_name: str,
    ) -> None:
        self.bucket_name = bucket_name
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
        )

    def upload_bytes(self, key: str, body: bytes, content_type: Optional[str]) -> None:
        put_args = {
            "Bucket": self.bucket_name,
            "Key": key,
            "Body": body,
        }
        if content_type:
            put_args["ContentType"] = content_type
        self.client.put_object(**put_args)
