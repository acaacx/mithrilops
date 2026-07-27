"""In-process pub/sub for SSE. One asyncio.Queue per subscriber.

Extension point: replace with Redis pub/sub for multi-replica fan-out.
"""

import asyncio


class Broadcast:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: str, payload: dict) -> None:
        for queue in self._subscribers:
            queue.put_nowait((event, payload))


broadcast = Broadcast()
