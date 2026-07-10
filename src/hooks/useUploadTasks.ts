import { useEffect, useState } from 'react';
import { uploadQueue, UploadTask } from '../lib/uploadQueue';

/** Reactive view of the upload queue, filtered to one capsule. */
export function useUploadTasks(capsuleId: string): UploadTask[] {
  const [tasks, setTasks] = useState<UploadTask[]>(() => uploadQueue.getTasks(capsuleId));

  useEffect(() => {
    setTasks(uploadQueue.getTasks(capsuleId));
    return uploadQueue.subscribe(() => {
      setTasks(uploadQueue.getTasks(capsuleId));
    });
  }, [capsuleId]);

  return tasks;
}
